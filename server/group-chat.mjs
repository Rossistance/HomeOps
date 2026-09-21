// FamiliOS — Famili sits in the family's own group chat, and mostly says nothing.
//
// Families coordinate where they already talk. Building a messaging surface inside the app
// asks them to move; this meets them in the iMessage thread they already have. The cost of
// being there is that everything else in this module exists to bound what "being there"
// means.
//
// ── Three things shape every decision below ────────────────────────────────────────────
//
// 1. THE BRIDGE IS SHARED. One Apple ID serves every household on the deployment
//    (docs/IMESSAGE_BLUEBUBBLES.md). Nothing in the transport tells two families apart, so
//    identity is decided by the SENDER, and a chat GUID is deployment-global rather than
//    household-scoped. That is why binding checks across tenants, and why the lock key here
//    carries no tenant prefix: at claim time the webhook has not called gate(), so
//    currentTenant() is the resident household and a "${T()}:" prefix would be a constant
//    pretending to be a scope.
//
// 2. A GROUP CHAT CONTAINS PEOPLE WHO NEVER AGREED TO ANY OF THIS. The durable transcript
//    holds messages from household MEMBERS only. A non-member's words live in an in-memory
//    window long enough to give the classifier context and are never written down. Their
//    handle is recorded as a slow per-chat hash so the chat can say "two people we don't
//    know" without holding who they are — pseudonymous, not anonymous, and said that way.
//    Binding requires an authenticated adult. Revoking requires nothing at all.
//
// 3. THE FLOOR IS CODE, NOT DATA — FOR WHAT SPEAKS UNPROMPTED. isToolStepAllowed treats an
//    EMPTY allow-list as PERMISSIVE — deny-only, the documented default every helper starts
//    from (helper-shape.mjs). So an allow-list on a helper record is a preference, not a
//    boundary: a UI edit, or a PATCH whose allowedToolIds arrives as a string, empties it
//    and the failure direction is FULL PRIVILEGE. Where the assistant speaks UNINVITED that
//    is unacceptable, so PROPOSAL_TOOL_IDS is a frozen constant the record cannot widen, the
//    deny-list is populated by NAME rather than by omission, and an emptied allow-list makes
//    the voice INERT rather than permissive.
//
// 4. …AND ATTRIBUTION, FOR WHAT WAS ASKED FOR. When a member addresses Famili by name
//    (group-agent.mjs, Lane 2) none of the above applies: they get the same dense agent and
//    the same full tool catalog as the app, because an assistant that can only reach three
//    hardcoded verbs is not one that can hold a conversation — and the voice agent this is
//    the foundation for will need every bit of that range. Safety there is not a smaller
//    menu but a real identity: the turn runs as agt_household, so the whole policy ladder
//    applies, and policy.mjs rule 4b degrades a non-adult's consequential calls to an
//    approval an adult signs. The lanes differ because uninvited speech and an answered
//    question are different acts, not because one of them is trusted less.
import crypto from "node:crypto";
import {
  runWithTenant, forEachTenant, currentTenant, withLock, appendAudit, getSettings,
  getMember, getAgent, putAgent, patchAgent, getRiskOverride,
  listImessageChats, getImessageChat, putImessageChat, patchImessageChat,
  getImessageMessage, putImessageMessage, deleteImessageMessageRec,
  listChatProposals, getChatProposal, putChatProposal, patchChatProposal,
  putChatDecision,
} from "./store.mjs";
import { resolveEffectivePolicy, ALLOWED, BLOCKED } from "./policy.mjs";
import { executeToolForChat } from "./engine.mjs";
import { queueApprovalRun } from "./assistant-agent.mjs";
import { resolveSmsSender } from "./sms.mjs";
import { isGroupChatGuid, sendAttachment } from "./bluebubbles.mjs";
import { mintPreviewToken } from "./preview-token.mjs";
import { screenshotPage } from "./web.mjs";
import { localDateKey, householdTimeZone } from "./household-time.mjs";

/* ─────────────────────────────── the floor ─────────────────────────────── */

/* WHAT THE FLOOR IS FOR, NOW THAT THERE ARE TWO LANES.
 *
 * It used to be the whole safety story: the group surface could reach exactly four tool ids
 * and nothing else, because the passive classifier was the only thing that could act and a
 * model handed a wide menu it would then be refused from narrates work it did not do.
 *
 * That argument still holds for LANE 1 — an 8B classifier returning a kind from an enum
 * must not be able to name a tool — and it does not hold for LANE 2, where a member
 * addressed Famili by name and gets the same dense agent and the same full catalog as the
 * app. Lane 2 is not gated by this list at all. It is gated by attribution: the turn runs
 * as agt_household, so engine.mjs applies the allow-list, the kill switch, the household's
 * risk overrides, and the actor's own standing (policy.mjs rule 4b), and anything
 * consequential is drafted and parked rather than executed.
 *
 * So the layers now protect named surfaces rather than "the group":
 *   1. PROPOSAL_TOOL_IDS  — what a LANE 1 proposal may become. Derived from the enum below
 *                           so the two cannot drift.
 *   2. CHAT_DENIED_TOOL_IDS — what agt_chat, the VOICE, may never touch.
 *   3. chatHelperUsable()  — an emptied allow-list makes the VOICE inert, not permissive.
 *   4. role attribution    — who is asking, applied to Lane 2's real tool calls.
 *
 * Derived, not restated: PROPOSAL_TOOL_IDS is exactly the values of PROPOSAL_KINDS, and is
 * defined beside that enum further down rather than here — Object.values() at this point in
 * the file would read the enum inside its temporal dead zone and throw at import. */

export const CHAT_HELPER_ID = "agt_chat";

/* agt_chat is the VOICE and nothing else now: the identity sms.send executes as, so "may
 * Famili speak in my group chat" stays the single dial an Owner already granted. Lane 1's
 * proposals execute as it too, and are separately held to PROPOSAL_TOOL_IDS.
 *
 * Existing records are NOT rewritten (see ensureChatHelper): a family's four-id list still
 * contains sms.send, so speaking keeps working, and the other three ids on it are simply
 * inert. Trimming them would be a write to every household's data to no effect. */
const CHAT_VOICE_TOOL_IDS = Object.freeze(["sms.send"]);

/** Named explicitly rather than left to omission — this is the layer that survives a UI
 *  edit, because isToolStepAllowed checks the deny-list first and unconditionally.
 *
 *  Scope: agt_chat, which is now only the VOICE (sms.send into a bound thread) and Lane 1's
 *  proposals. It does NOT govern Lane 2, which acts as agt_household. */
const CHAT_DENIED_TOOL_IDS = Object.freeze([
  "homeops.notify_contact", "homeops.send_notification_draft", "homeops.create_approval",
  "homeops.write_memory", "homeops.plan_meal", "homeops.find_places", "homeops.read_file",
  "homeops.extract_from_file", "homeops.create_artifact", "homeops.update_event_checklist",
  "homeops.assign_driver", "homeops.assign_what_to_bring", "homeops.attach_note_or_file_reference",
  "web.read", "web.search", "browser.open", "browser.download",
  "gmail.search", "gmail.send", "calendar.list", "calendar.create", "http.post", "http.get",
]);

/** Limits. A chat that has said its piece for the day has said enough. */
export const MAX_SPOKEN_PER_DAY = 6;
/* …but that cap is about UNPROMPTED speech. An answer to a member who addressed Famili by
 * name is the same act as a 1:1 text, which has no cap at all, and a seventh question of the
 * day meeting silence reads as broken rather than as restraint. Capped separately, and not
 * uncapped: this is a shared bot number and a member leaning on the wake word is a real cost.
 * The harder ceiling is the household's aiDailyCallBudget, which runAssistantAgent enforces. */
export const MAX_ANSWERS_PER_DAY = 30;
const WINDOW_MAX = 24;              // messages held in the in-memory debounce window
const WINDOW_TTL_MS = 30 * 60_000;  // …and for how long, restart aside
const RING_MAX = 40;                // recentMessageIds on the chat record
const DEFAULT_TRANSCRIPT_DAYS = 0;  // ephemeral by default: the setting that holds least
/* How long a Lane 2 turn may hold a chat before another message may start one. Longer than
 * runAssistantAgent's own TURN_TIMEOUT_MS (240s) so the lease outlives the work it guards;
 * a lease that expired first would let a second turn start beside a live one. Stored ON THE
 * CHAT RECORD rather than in memory, because this deployment restarts on every deploy and an
 * in-memory lease is a lease that silently vanishes mid-turn. */
const TURN_LEASE_MS = 300_000;

/* ───────────────────────── the chat helper identity ───────────────────────── */

/** Seed the one identity the group surface acts as. Idempotent; safe every boot. */
export function ensureChatHelper(householdId = currentTenant()) {
  const existing = getAgent(CHAT_HELPER_ID);
  if (existing) {
    // Repair only what must never be empty. A family's autonomy choice is THEIRS and is
    // never touched here — if they granted this helper the right to speak, it keeps it.
    // Repaired only when EMPTY, never trimmed back toward the seed. A family that removed
    // one entry made a choice; a family with an empty list has no floor left. Restoring on
    // every boot would also mean a write on every boot, which the CI data-isolation gate
    // and every household's disk would both rather not have.
    const allow = Array.isArray(existing.allowedToolIds) ? existing.allowedToolIds : [];
    const deny = Array.isArray(existing.deniedToolIds) ? existing.deniedToolIds : [];
    const patch = {};
    if (!allow.length) patch.allowedToolIds = [...CHAT_VOICE_TOOL_IDS];
    if (!deny.length) patch.deniedToolIds = [...CHAT_DENIED_TOOL_IDS];
    if (Object.keys(patch).length) patchAgent(CHAT_HELPER_ID, patch);
    return getAgent(CHAT_HELPER_ID);
  }
  const now = new Date().toISOString();
  putAgent({
    id: CHAT_HELPER_ID, householdId, createdBy: "system",
    name: "Famili in chat", icon: "MessageCircle",
    purpose: "Listens in a family group chat and offers to add what the family has already settled.",
    instructions: "Only act on what the family has clearly decided. Never speak twice about the same thing.",
    status: "Active", enabled: true,
    schedule: { kind: "manual" },
    // Ships SILENT. Speaking is sms.send, which is high-stakes on three counts, so an Owner
    // or Adult Admin has to grant it deliberately. Nothing here grants itself anything.
    approvalPolicy: { autoAllow: [], alwaysApprove: [], unattended: { enabled: false } },
    allowedToolIds: [...CHAT_VOICE_TOOL_IDS],
    deniedToolIds: [...CHAT_DENIED_TOOL_IDS],
    allowedFunctionIds: [], deniedFunctionIds: [],
    visibility: "household", nestId: null,
    conversationId: null, lastRun: null, triggerId: null,
    system: true, version: 1, createdAt: now, updatedAt: now,
  });
  appendAudit({ type: "helper.default_seeded", agentId: CHAT_HELPER_ID, householdId });
  return getAgent(CHAT_HELPER_ID);
}

/**
 * R1's third layer. An allow-list that has been emptied makes this helper permissive, not
 * restrictive — so the listener refuses to act rather than acting with full privilege.
 * Inert is visible and recoverable; permissive is invisible until it does something.
 * @returns {{ok:true, agent:object} | {ok:false, error:string, message:string}}
 */
export function chatHelperUsable() {
  const agent = getAgent(CHAT_HELPER_ID);
  if (!agent) return { ok: false, error: "chat_helper_misconfigured", message: "Famili in chat isn't set up on this household yet." };
  const allow = Array.isArray(agent.allowedToolIds) ? agent.allowedToolIds : [];
  if (!allow.length) {
    return { ok: false, error: "chat_helper_misconfigured", message: "Famili in chat has no tool list, so it isn't acting on anything. Restore its allowed tools in Helpers." };
  }
  if (agent.status === "Paused" || agent.enabled === false) {
    return { ok: false, error: "chat_helper_paused", message: "Famili in chat is paused." };
  }
  return { ok: true, agent };
}

/* ───────────────────────── may it speak at all? ───────────────────────── */

/** The sms.send capability, as engine.mjs builds it for the policy call. Kept literal here
 *  so the pre-flight question and the real execution ask the SAME question. */
const SMS_SEND_CAP = Object.freeze({
  id: "sms.send", name: "Send text", requiresApproval: true,
  risk: "High", action: "Send", delivers: true, external: true,
});

/**
 * Can Famili speak into a chat without parking an approval first? Asked of the policy
 * engine, never guessed, so every dial that could grant it is honoured and NAMED:
 *   • the helper's own unattended grant (Owner/Adult Admin only — helpers.mjs sets
 *     includeHighRisk in exactly one place and nothing accepts approvalPolicy from a body)
 *   • settings.autonomy = "Trusted"          (household-level, rule 7)
 *   • a per-tool risk override with skipApproval (household-level, rule 5)
 * The household-level two can be flipped without ever opening this helper, which is why
 * the answer carries WHICH grant applied — so the bind screen and the audit can say.
 * @returns {{ok:true, grant:string} | {ok:false, error:string, message:string}}
 */
export function speakPermission(householdId = currentTenant()) {
  const usable = chatHelperUsable();
  if (!usable.ok) return usable;
  const decision = resolveEffectivePolicy({
    cap: SMS_SEND_CAP,
    agent: usable.agent,
    settings: getSettings(householdId),
    override: getRiskOverride(householdId, "sms.send", null),
  });
  if (decision.decision === ALLOWED) {
    const grant = decision.rule === "household.risk_override" ? "risk_override"
      : decision.rule.startsWith("household.autonomy") ? "household_trusted"
        : "helper_unattended";
    return { ok: true, grant, rule: decision.rule };
  }
  if (decision.decision === BLOCKED) {
    return { ok: false, error: "speak_blocked", message: decision.reason };
  }
  return {
    ok: false, error: "speak_not_authorized",
    message: "An Owner needs to allow Famili to text this chat (Helpers → Famili in chat → let it act on its own).",
  };
}

/* ───────────────────────── chat records ───────────────────────── */

const chatId = () => "ich_" + crypto.randomBytes(8).toString("hex");
const messageId = () => "imsg_" + crypto.randomBytes(8).toString("hex");
const nowISO = () => new Date().toISOString();

/** Within the CURRENT tenant. Small collection (one row per bound chat), so a scan here is
 *  honest; the message collection is the one that must never be scanned. */
export function chatByGuid(chatGuid) {
  if (!chatGuid) return null;
  return listImessageChats((c) => c.chatGuid === chatGuid)[0] ?? null;
}

/**
 * Which household owns this chat GUID? Fans out across tenants, mirroring how a text finds
 * its family today. forEachTenant swallows per-tenant errors with a bare catch, so the
 * read is kept trivial: anything that can throw stays outside it.
 * @returns {Promise<{ok:true, chat:object, householdId:string} | {ok:false, error:string, count?:number}>}
 */
export async function resolveGroupChat(chatGuid) {
  const hits = [];
  await forEachTenant((householdId) => {
    const c = chatByGuid(chatGuid);
    if (c) hits.push({ householdId, chat: c });
  });
  if (hits.length === 0) return { ok: false, error: "chat_not_bound" };
  if (hits.length > 1) return { ok: false, error: "chat_ambiguous", count: hits.length };
  return { ok: true, chat: hits[0].chat, householdId: hits[0].householdId };
}

/** Which households recognise this sender as a verified, opted-in member? Enrollment needs
 *  the consent-bearing resolver, not the consent-ignoring one STOP/HELP uses. */
export async function householdsForVerifiedSender(handle) {
  const hits = [];
  await forEachTenant((householdId) => {
    const found = resolveSmsSender(handle);
    if (found) hits.push({ householdId, member: found.member });
  });
  return hits;
}

/* ───────────────── participant hashes: pseudonymous, and said so ───────────────── */

const _hashCache = new Map(); // `${salt}:${handle}` → hex

/** Slow hash of a handle under a PER-CHAT salt. Scoped to dedupe within one chat, which is
 *  all it is for. Honest about what it is not: a ten-digit space is small, and anyone
 *  holding this database holds the salt beside it — and holds contact_methods, where the
 *  members' real numbers already live. This resists casual inspection of a backup. It is
 *  pseudonymisation, not anonymisation, and the UI says the same word. */
function handleHash(handle, salt) {
  const key = `${salt}:${handle}`;
  const hit = _hashCache.get(key);
  if (hit) return hit;
  const out = crypto.scryptSync(handle, salt, 16, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
  if (_hashCache.size > 4000) _hashCache.clear();
  _hashCache.set(key, out);
  return out;
}

/* ───────────────── the in-memory window (non-members included) ───────────────── */

const _windows = new Map(); // chatGuid → { at, items: [{ handle, memberId, text, at }] }

/** Context for the classifier. Non-member text reaches here and goes no further — it is
 *  never written to the database, so it does not survive a restart, and the classifier is
 *  a little less well grounded after one. That is the trade, taken deliberately. */
export function pushWindow(chatGuid, item) {
  const w = _windows.get(chatGuid) ?? { at: 0, items: [] };
  w.items.push(item);
  if (w.items.length > WINDOW_MAX) w.items = w.items.slice(-WINDOW_MAX);
  w.at = item.atMs;
  _windows.set(chatGuid, w);
  if (_windows.size > 500) {
    for (const [k, v] of _windows) if (item.atMs - v.at > WINDOW_TTL_MS) _windows.delete(k);
  }
  return w;
}
export function readWindow(chatGuid, nowMs) {
  const w = _windows.get(chatGuid);
  if (!w) return [];
  if (nowMs - w.at > WINDOW_TTL_MS) { _windows.delete(chatGuid); return []; }
  return w.items;
}
export function clearWindow(chatGuid) { _windows.delete(chatGuid); }

/* ───────────────── recording an inbound message ───────────────── */

/**
 * Record one inbound group message in the CURRENT tenant.
 *
 * A member's message becomes a durable row and joins both indexes on the chat record: the
 * ring (the classifier's recent window) and the day bucket (a coordination loop's 24-48h
 * audit).
 *
 * A NON-MEMBER'S MESSAGE DEPENDS ON ONE SETTING, and the default is unchanged.
 *
 * By default it joins neither index — it goes to the in-memory window only, and all that
 * persists is a pseudonymous handle hash and a count. That default exists because this
 * deployment is one Apple ID for every household: a grandparent or a neighbour in the thread
 * never agreed to anything, and storing their words is a decision made on their behalf.
 *
 * `storeAllChatParticipants` lets ONE household decide otherwise for its own chats — a
 * family whose thread is only ever family, who would rather Famili had the whole
 * conversation as context. It is off for everyone else, it takes the household PIN to turn
 * on, and Famili re-introduces itself in every bound chat to say which policy is in force,
 * because the announcement it already made is a promise and a stale promise is a lie.
 *
 * Even then the raw handle is NOT stored on the row. Keeping the message is what the family
 * chose; keeping a stranger's phone number is a second, larger decision nobody asked for.
 */
export function recordInboundGroupMessage({ chat, msg, memberId, atMs }) {
  const isMember = !!memberId;
  pushWindow(chat.chatGuid, { handle: msg.address, memberId: memberId ?? null, text: msg.text, atMs, isMember });

  const patch = { lastMessageAt: new Date(atMs).toISOString(), updatedAt: nowISO() };
  let fromHandleHash = null;
  if (!isMember) {
    const h = handleHash(msg.address, chat.participantSalt);
    fromHandleHash = h;
    const seen = Array.isArray(chat.unknownParticipantHashes) ? chat.unknownParticipantHashes : [];
    if (!seen.some((x) => x.h === h)) patch.unknownParticipantHashes = [...seen, { h, firstSeenAt: new Date(atMs).toISOString() }];
    if (!storeAllParticipants(chat.householdId)) {
      patchImessageChat(chat.id, patch);
      return { stored: false, reason: "non_member" };
    }
  }

  const known = Array.isArray(chat.knownParticipants) ? chat.knownParticipants : [];
  if (isMember && !known.some((p) => p.memberId === memberId)) {
    patch.knownParticipants = [...known, { memberId, handle: msg.address, firstSeenAt: new Date(atMs).toISOString() }];
  }

  const row = {
    id: messageId(), householdId: chat.householdId, chatGuid: chat.chatGuid,
    guid: msg.guid ?? null, fromMemberId: memberId ?? null, text: String(msg.text ?? ""),
    // Attributable without identifying: enough to dedupe and to keep the transcript legible,
    // and not enough to recover whose number it was.
    ...(fromHandleHash ? { fromHandleHash } : {}),
    at: new Date(atMs).toISOString(), direction: "in",
  };
  putImessageMessage(row);

  const ring = Array.isArray(chat.recentMessageIds) ? chat.recentMessageIds : [];
  patch.recentMessageIds = [...ring, row.id].slice(-RING_MAX);
  const day = localDateKey(atMs, householdTimeZone(chat.householdId));
  const buckets = chat.messageIdsByDay && typeof chat.messageIdsByDay === "object" ? chat.messageIdsByDay : {};
  patch.messageIdsByDay = { ...buckets, [day]: [...(buckets[day] ?? []), row.id] };
  patchImessageChat(chat.id, patch);
  return { stored: true, row, member: isMember };
}

/** Record what Famili itself said, so the thread reads back whole. */
export function recordOutboundGroupMessage({ chat, text, atMs }) {
  const row = {
    id: messageId(), householdId: chat.householdId, chatGuid: chat.chatGuid,
    guid: null, fromMemberId: null, text: String(text ?? ""),
    at: new Date(atMs).toISOString(), direction: "out",
  };
  putImessageMessage(row);
  const fresh = getImessageChat(chat.id) ?? chat;
  const ring = Array.isArray(fresh.recentMessageIds) ? fresh.recentMessageIds : [];
  const day = localDateKey(atMs, householdTimeZone(chat.householdId));
  const buckets = fresh.messageIdsByDay && typeof fresh.messageIdsByDay === "object" ? fresh.messageIdsByDay : {};
  patchImessageChat(chat.id, {
    recentMessageIds: [...ring, row.id].slice(-RING_MAX),
    messageIdsByDay: { ...buckets, [day]: [...(buckets[day] ?? []), row.id] },
    updatedAt: nowISO(),
  });
  return row;
}

/* ───────────────── reading it back, without ever scanning ───────────────── */

/** The classifier's window: at most RING_MAX point reads. */
export function recentMessages(chat, limit = RING_MAX) {
  const ids = (Array.isArray(chat.recentMessageIds) ? chat.recentMessageIds : []).slice(-limit);
  return ids.map((id) => getImessageMessage(id)).filter(Boolean);
}

/**
 * THE CONVERSATION, as both lanes see it. One reader, so the passive classifier and the
 * addressed agent provably read the same thing instead of drifting apart.
 *
 * Either/or, not a union: the in-memory window holds everyone's text and is the real
 * conversation; the durable ring is a restart fallback and is member-only by construction,
 * so after a restart the classifier is less well grounded. That is the trade the third-party
 * rule buys, and it is stated here rather than discovered later.
 *
 * Famili's own outbound rows carry fromMemberId: null, so on the fallback path they would
 * otherwise be labelled as a stranger's words. `isSelf` keeps them distinguishable.
 */
export function mergedWindow(chat, nowMs) {
  const live = readWindow(chat.chatGuid, nowMs);
  if (live.length) return live.map((i) => ({ ...i, isSelf: false }));
  return recentMessages(chat, 12).map((m) => ({
    text: m.text,
    memberId: m.fromMemberId ?? null,
    isMember: !!m.fromMemberId,
    isSelf: m.direction === "out",
    atMs: Date.parse(m.at),
  }));
}

/** A coordination loop's audit: day buckets between two instants, still point reads. This
 *  is why the buckets exist — the ring alone caps at 40 messages and a 48h window in a busy
 *  family chat runs straight past it, which would make a loop miss a resolution silently. */
export function messagesBetween(chat, fromMs, toMs) {
  const tz = householdTimeZone(chat.householdId);
  const buckets = chat.messageIdsByDay && typeof chat.messageIdsByDay === "object" ? chat.messageIdsByDay : {};
  const wanted = new Set();
  for (let t = fromMs; t <= toMs + 86400000; t += 86400000) wanted.add(localDateKey(t, tz));
  wanted.add(localDateKey(toMs, tz));
  const out = [];
  for (const day of wanted) {
    for (const id of buckets[day] ?? []) {
      const m = getImessageMessage(id);
      if (!m) continue;
      const ms = Date.parse(m.at);
      if (Number.isFinite(ms) && ms >= fromMs && ms <= toMs) out.push(m);
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Retention. Drops whole day buckets past the household's window and point-deletes their
 *  rows — no scan, because deciding "which rows are old" from the rows themselves would
 *  need one. Writes NOTHING when no bucket has expired: the CI data-isolation gate hashes
 *  the live server's data dir and requires it byte-identical while the suite runs beside
 *  it, and an idle household must therefore produce no writes at all. */
export function pruneChatTranscript(chat, nowMs) {
  const days = Number(getSettings(chat.householdId).chatTranscriptDays ?? DEFAULT_TRANSCRIPT_DAYS);
  const keep = Number.isFinite(days) && days > 0 ? Math.min(90, Math.floor(days)) : 0;
  const tz = householdTimeZone(chat.householdId);
  const buckets = chat.messageIdsByDay && typeof chat.messageIdsByDay === "object" ? chat.messageIdsByDay : {};
  const keys = Object.keys(buckets);
  if (!keys.length) return { dropped: 0, buckets: 0 };

  // keep = 0 means ephemeral: today's bucket only, so the classifier still has a window
  // and nothing outlives the conversation it came from.
  const alive = new Set();
  for (let i = 0; i <= keep; i++) alive.add(localDateKey(nowMs - i * 86400000, tz));

  const expired = keys.filter((k) => !alive.has(k));
  if (!expired.length) return { dropped: 0, buckets: 0 };

  let dropped = 0;
  const next = { ...buckets };
  for (const k of expired) {
    for (const id of next[k] ?? []) { if (deleteImessageMessageRec(id)) dropped++; }
    delete next[k];
  }
  const live = new Set(Object.values(next).flat());
  patchImessageChat(chat.id, {
    messageIdsByDay: next,
    recentMessageIds: (chat.recentMessageIds ?? []).filter((id) => live.has(id)),
    updatedAt: nowISO(),
  });
  return { dropped, buckets: expired.length };
}

/* ───────────────── enrollment ───────────────── */

/**
 * A group message arrived for a chat nobody has bound. Create a PENDING record — in the one
 * household whose verified member spoke, and nowhere else — so an adult can find it in the
 * app. Nothing is sent to the chat. If no verified member of any household has spoken here
 * yet, NOTHING IS WRITTEN AT ALL: the chat stays invisible, which is the only answer that
 * does not confirm to a stranger that this number belongs to anything.
 */
export async function notePendingChat({ msg, atMs }) {
  const hits = await householdsForVerifiedSender(msg.address);
  if (hits.length === 0) return { ok: false, error: "sender_not_a_member" };
  if (hits.length > 1) {
    appendAudit({ type: "imessage.group_ambiguous_sender", chatGuid: msg.chatGuid, households: hits.length });
    return { ok: false, error: "chat_ambiguous", count: hits.length };
  }
  const { householdId, member } = hits[0];
  return await runWithTenant(householdId, () => {
    const existing = chatByGuid(msg.chatGuid);
    if (existing) return { ok: true, chat: existing, householdId, created: false };
    /* Seed the chat identity HERE rather than at boot, which is both the smaller change and
     * the more honest one. A household that never has a group chat never grows a helper it
     * did not ask for — the Helpers list is a list of things the family chose — and an
     * absent record is INERT, not permissive, because chatHelperUsable refuses on a missing
     * agent exactly as it refuses on an emptied allow-list. It also means the identity, and
     * the autonomy dial that decides whether Famili may ever speak, appear in the app at
     * the moment they start meaning something. */
    ensureChatHelper(householdId);
    const rec = putImessageChat({
      id: chatId(), householdId, chatGuid: msg.chatGuid, service: msg.service ?? "iMessage",
      displayName: "", status: "pending",
      boundBy: null, boundAt: null, announcedAt: null, speakGrant: null,
      participantSalt: crypto.randomBytes(16).toString("hex"),
      knownParticipants: [{ memberId: member.actorId, handle: msg.address, firstSeenAt: new Date(atMs).toISOString() }],
      unknownParticipantHashes: [],
      recentMessageIds: [], messageIdsByDay: {},
      lastMessageAt: new Date(atMs).toISOString(),
      lastTriagedAt: null, triageCursorAt: null,
      lastSpokeAt: null, spokeDayKey: null, spokeCountDay: 0,
      createdAt: nowISO(), updatedAt: nowISO(),
    });
    appendAudit({ type: "imessage.chat_pending", chatId: rec.id, chatGuid: msg.chatGuid, householdId, actorId: member.actorId });
    return { ok: true, chat: rec, householdId, created: true };
  });
}

/** The announcement. No household name: it tells every non-member that this household
 *  exists and who connected it, and a first name is already visible to everyone in the
 *  thread. A deliberate, bounded exception to the silence rule — the rule protects people
 *  who never chose FamiliOS, and an announcement is how they get to choose. */
/* WHAT IS KEPT IS STATED, NOT IMPLIED — and it has to stay true.
 *
 * This sentence is read by people who never signed up for FamiliOS, and it is the only
 * moment they get to decide. So the retention clause is the one the household is ACTUALLY
 * running, not the one the default happens to be. The default branch returns the original
 * wording byte for byte: the promise made to every chat bound before the setting existed
 * does not get quietly reworded underneath them. */
export function announcementText(memberName, { storeAll = false } = {}) {
  const retention = storeAll
    ? "I keep this chat's messages so I can follow what you're arranging"
    : "I only keep messages from their household's own members; everyone else's stay unsaved";
  return `Famili here — ${memberName} connected me to this chat so I can offer to add things to their family calendar and lists. ${retention}. Reply "Famili stop" any time and I'll leave and stay gone.`;
}

/**
 * Bind a pending chat. An authenticated adult action.
 *
 * The speak grant must ALREADY exist. The announcement is itself an sms.send, and sms.send
 * is high-stakes, so without the grant it would park for approval and the bind would be
 * neither done nor failed. Requiring the grant first removes the half-bound state and puts
 * the disclosure in the right order: the adult learns Famili will be able to speak here
 * before it joins.
 */
export async function bindChat({ chatId: id, session, displayName = "" }) {
  const chat = getImessageChat(id);
  if (!chat || chat.householdId !== session.householdId) return { ok: false, status: 404, error: "not_found", message: "That chat isn't here." };
  if (chat.status === "bound") return { ok: true, chat, already: true };
  if (chat.status === "revoked") return { ok: false, status: 409, error: "chat_revoked", message: "Someone in that chat asked Famili to leave. It stays gone." };

  const perm = speakPermission(session.householdId);
  if (!perm.ok) return { ok: false, status: 409, error: perm.error, message: perm.message };

  /* PENDING-5, at the point where it stops being theoretical. Chat GUIDs are
   * deployment-global and the bridge is one Apple ID, so two households can each hold a
   * record for one thread. The announcement would then disclose one household to the
   * other's members. Refuse, loudly, rather than discover it afterwards. */
  const elsewhere = [];
  await forEachTenant((hh) => {
    if (hh === session.householdId) return;
    const other = chatByGuid(chat.chatGuid);
    if (other && other.status !== "revoked") elsewhere.push(hh);
  });
  if (elsewhere.length) {
    appendAudit({ type: "imessage.chat_cross_household", chatId: id, chatGuid: chat.chatGuid, householdId: session.householdId, others: elsewhere.length });
    return { ok: false, status: 409, error: "chat_cross_household", message: "Another household is already using this chat. Famili can't join it twice." };
  }

  const memberName = getMember(session.actorId)?.displayName ?? "Someone";
  const said = await speakToChat({
    chat, householdId: session.householdId, session,
    text: announcementText(memberName, { storeAll: storeAllParticipants(session.householdId) }), kind: "announcement", force: true,
  });
  if (!said.ok) {
    /* A silent join is not on the menu, so a failed announcement is a failed bind. Say WHY
     * though: "I couldn't introduce myself" for a permission refusal sends an Owner to go
     * and check their Mac, and the real cause only appears in an audit line they will
     * never read. The transport failing and the policy refusing are different problems
     * with different fixes. */
    appendAudit({ type: "imessage.chat_bind_failed", chatId: id, householdId: session.householdId, error: said.error });
    const permissionShaped = said.error === "speak_not_authorized" || said.error === "speak_blocked" || said.error === "external_actions_disabled";
    return {
      ok: false, status: permissionShaped ? 409 : 502,
      error: permissionShaped ? said.error : "announcement_failed",
      message: permissionShaped ? said.message : `I couldn't introduce myself in that chat, so I haven't joined it. (${said.message ?? said.error})`,
    };
  }

  const next = patchImessageChat(id, {
    status: "bound", boundBy: session.actorId, boundAt: nowISO(), announcedAt: nowISO(),
    speakGrant: perm.grant, displayName: String(displayName ?? "").slice(0, 80),
    updatedAt: nowISO(),
  });
  appendAudit({ type: "imessage.chat_bound", chatId: id, chatGuid: chat.chatGuid, householdId: session.householdId, actorId: session.actorId, grant: perm.grant });
  return { ok: true, chat: next };
}

/**
 * Leave, and stay gone. Binding takes an authenticated adult; this takes nothing — anyone
 * in the thread, member or not, verified or not, can end it. The asymmetry is the point.
 * The transcript goes immediately rather than ageing out.
 */
export function revokeChat({ chat, by = "participant", actorId = null }) {
  const buckets = chat.messageIdsByDay && typeof chat.messageIdsByDay === "object" ? chat.messageIdsByDay : {};
  let dropped = 0;
  for (const ids of Object.values(buckets)) for (const id of ids) { if (deleteImessageMessageRec(id)) dropped++; }
  clearWindow(chat.chatGuid);
  const next = patchImessageChat(chat.id, {
    status: "revoked", revokedAt: nowISO(), revokedBy: by,
    messageIdsByDay: {}, recentMessageIds: [], updatedAt: nowISO(),
  });
  appendAudit({ type: "imessage.chat_revoked", chatId: chat.id, chatGuid: chat.chatGuid, householdId: chat.householdId, by, actorId, messagesDeleted: dropped });
  return { ok: true, chat: next, messagesDeleted: dropped };
}

/** Whole-message match, deliberately narrow. The precedent is classifySmsKeyword: a
 *  sentence CONTAINING "stop" is not a request to leave, and treating it as one would make
 *  the feature impossible to talk about in the chat it lives in. */
const STOP_RE = /^(famili[,!. ]*\s*)?(stop|leave|go away|unsubscribe|opt ?out)[.!]?$/i;
/** The stop words on their own, for a message whose address has already been stripped. */
const STOP_WORD_RE = /^(stop|leave|go away|unsubscribe|opt ?out)[.!]?$/i;
export function isStopRequest(text) {
  const t = String(text ?? "").trim();
  if (!t || t.length > 40) return false;
  if (STOP_RE.test(t) || /^famili\s+(stop|leave|go away)[.!]?$/i.test(t)) return true;
  /* EVERY WAY OF ADDRESSING FAMILI HAS TO WORK FOR "STOP" TOO.
   *
   * STOP_RE only ever knew the bare and comma forms. Once detectWake taught the feature
   * three more ways to say its name, "Famili: stop", "@famili stop" and "hey famili stop"
   * all fell through it — and then matched the WAKE rule instead, which would have answered
   * a request to leave by starting a dense model turn with the prompt "stop". Ordering the
   * stop check first does not help when the stop check itself does not recognise the
   * sentence. Revocation is the one thing anyone in the thread may do, so it recognises
   * every address form the rest of the module does. */
  const w = detectWake(t);
  return !!w && w.prompt.length > 0 && STOP_WORD_RE.test(w.prompt);
}

/* ───────────────── being addressed (Lane 2) ─────────────────
 *
 * Lane 1 is Famili overhearing. Lane 2 is Famili being SPOKEN TO, and the difference has to
 * be decided by a regex rather than a model, because the decision is what determines whether
 * a model runs at all.
 *
 * STRICT, and the strictness is the design. An explicit address marker is required — a
 * leading @, a greeting, or punctuation after the name. Bare "famili <something>" does NOT
 * match, because "we should ask Famili about it" and "Famili is being weird lately" are the
 * family TALKING ABOUT the assistant, and answering those is precisely the interrupting
 * houseguest this whole feature is built to avoid. The same whole-message/anchored precedent
 * as STOP_RE above and classifySmsKeyword in sms.mjs.
 *
 * The cost is recall: "Famili what's on Saturday?" is a natural phrasing and it misses. That
 * is a real trade and it is NOT being guessed at — wakeNearMiss() below records every one of
 * those so the rule can be widened later against a measured number instead of an argument.
 *
 * \b after the name keeps "familiar", "familia" and "family" out. */
const WAKE_RE = new RegExp(
  "^\\s*(?:" +
    "@famili(?:os)?\\b[\\s,:;!?.-]*" +                              // @famili …
    "|(?:hey|hi|hello|ok|okay|yo)[\\s,]+famili(?:os)?\\b[\\s,:;!?.-]*" + // hey famili …
    "|famili(?:os)?\\b\\s*[,:;!?.\\u2014-]+\\s*" +                   // famili, … / famili: …
  ")",
  "i",
);
/** Just the name, nothing after it — "Famili?" or "@famili". A valid address with no ask. */
const WAKE_BARE_RE = /^\s*@?famili(?:os)?\b\s*[,:;!?.—-]*\s*$/i;

/**
 * Was Famili addressed? Returns `{ prompt }` with the address stripped, or null.
 * An empty prompt is a VALID wake — someone said its name and nothing else.
 */
export function detectWake(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (WAKE_BARE_RE.test(t)) return { prompt: "" };
  const m = WAKE_RE.exec(t);
  if (!m) return null;
  return { prompt: t.slice(m[0].length).trim() };
}

/**
 * A message that BEGINS with the name but failed the strict test — "Famili what's on
 * Saturday?". Recorded, never acted on. This is the instrument that turns "should the rule
 * be looser?" into a question with an answer. Deliberately excludes anything detectWake
 * already matched and anything that is a stop request.
 */
export function wakeNearMiss(text) {
  const t = String(text ?? "").trim();
  if (!t || detectWake(t) || isStopRequest(t)) return false;
  return /^\s*famili(?:os)?\b/i.test(t);
}

/* ───────────────── speaking ───────────────── */

const dayKeyFor = (householdId, atMs) => localDateKey(atMs, householdTimeZone(householdId));

/**
 * Say one thing into a bound chat.
 *
 * Deliberately NOT replyToSender: that helper calls sendText directly and therefore
 * bypasses the household kill switch, which is survivable for an answer a person asked for
 * and is not survivable on a surface that speaks unprompted. This goes through
 * executeToolForChat with the chat helper's identity, so isToolStepAllowed and
 * resolveEffectivePolicy both run and the kill switch is asserted at every layer below.
 *
 * The GUID is authorized HERE, against the stored record, because sms.send has no
 * recipient-verification gate of its own: anything holding an approval for it can address
 * any number or chat. A model-supplied GUID never reaches it, and `to` is never set, so the
 * rememberedChatGuid fallback inside the connector cannot fire either.
 */
/* `budget` is WHICH ceiling this utterance counts against, and the distinction is the
 * whole point: MAX_SPOKEN_PER_DAY exists to stop Famili volunteering too often, which
 * has nothing to say about answering a member who used its name. "unprompted" is the
 * default so every existing caller keeps today's behaviour exactly; force:true still
 * means "no ceiling at all" (announcements, goodbyes) and is spelled "none". */
export async function speakToChat({ chat, householdId, session, text, kind = "proposal", force = false, atMs = null, budget = "unprompted" }) {
  const at = atMs ?? Date.parse(nowISO());
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, error: "invalid_input", message: "Nothing to say." };

  if (!chat || chat.householdId !== householdId) return { ok: false, error: "chat_not_bound", message: "That chat isn't bound to this household." };
  if (chat.status === "revoked") return { ok: false, error: "chat_revoked", message: "That chat asked Famili to leave." };
  if (!force && chat.status !== "bound") return { ok: false, error: "chat_not_bound", message: "That chat isn't bound." };
  if (!chat.chatGuid || !isGroupChatGuid(chat.chatGuid)) return { ok: false, error: "chat_not_bound", message: "That chat GUID isn't a group thread." };

  // Anti-spam. A chat that has said its piece for the day has said enough; refused in
  // silence, because the alternative is announcing the limit into the thread.
  const day = dayKeyFor(householdId, at);
  const lane = force ? "none" : budget;
  const spoken = chat.spokeDayKey === day ? Number(chat.spokeCountDay ?? 0) : 0;
  const answered = chat.answerDayKey === day ? Number(chat.answerCountDay ?? 0) : 0;
  if (lane === "unprompted" && spoken >= MAX_SPOKEN_PER_DAY) {
    appendAudit({ type: "imessage.speak_budget_exhausted", chatId: chat.id, householdId, spoken });
    return { ok: false, error: "speak_budget_exhausted", message: "Famili has already said enough in that chat today." };
  }
  if (lane === "answer" && answered >= MAX_ANSWERS_PER_DAY) {
    appendAudit({ type: "imessage.answer_budget_exhausted", chatId: chat.id, householdId, answered });
    return { ok: false, error: "answer_budget_exhausted", message: "Famili has answered as much as it can in that chat today." };
  }

  const usable = chatHelperUsable();
  if (!usable.ok) return usable;

  const out = await executeToolForChat({
    toolId: "sms.send",
    // chatGuid comes from the STORED record, never from a model or a request body.
    input: { chatGuid: chat.chatGuid, body },
    session: session ?? { actorId: chat.boundBy ?? "scheduler", householdId, role: "Owner" },
    agent: usable.agent,
    conversationId: null,
  });

  if (out.needsApproval) {
    return { ok: false, error: "speak_not_authorized", message: "An Owner needs to allow Famili to text this chat (Helpers → Famili in chat → let it act on its own)." };
  }
  if (!out.ok) return { ok: false, error: out.error ?? "send_failed", message: out.message ?? "The message didn't send." };

  /* Only the lane that was charged is incremented. An answer must not eat the unprompted
   * allowance, or a talkative afternoon would silence the evening's proposals. */
  patchImessageChat(chat.id, {
    lastSpokeAt: new Date(at).toISOString(),
    ...(lane === "answer"
      ? { answerDayKey: day, answerCountDay: answered + 1 }
      : lane === "unprompted" ? { spokeDayKey: day, spokeCountDay: spoken + 1 } : {}),
    updatedAt: nowISO(),
  });
  recordOutboundGroupMessage({ chat: getImessageChat(chat.id) ?? chat, text: body, atMs: at });
  appendAudit({ type: "imessage.spoke", chatId: chat.id, chatGuid: chat.chatGuid, householdId, kind });
  return { ok: true, result: out.result };
}

/* ───────────────── the Lane 2 turn lease ─────────────────
 *
 * A Lane 2 turn is a dense model call that may run for minutes. It CANNOT be held inside
 * withChatLock: that would block every other message in the chat for the duration —
 * including "Famili stop", which is the one message that must never wait — stall the triage
 * sweep's sequential pass, and make a re-delivery's dedupe check queue behind the very turn
 * it is supposed to short-circuit.
 *
 * So the lock is used for the claim (milliseconds, no model) and the lease guards the work.
 * Taking and releasing are separate, both cheap, and the release is guarded by the message
 * guid so a zombie turn finishing late cannot clear the lease a reclaimer already took.
 */
export function takeTurnLease({ chat, messageGuid, actorId, atMs }) {
  const fresh = getImessageChat(chat.id) ?? chat;
  const live = fresh.activeTurn;
  if (live?.startedAt && atMs - live.startedAt < TURN_LEASE_MS) {
    return { ok: false, error: "turn_in_flight", heldBy: live.messageGuid ?? null };
  }
  const reclaimed = !!live;
  patchImessageChat(fresh.id, { activeTurn: { messageGuid, startedAt: atMs, actorId: actorId ?? null }, updatedAt: nowISO() });
  return { ok: true, reclaimed };
}

export function releaseTurnLease({ chat, messageGuid }) {
  const fresh = getImessageChat(chat.id);
  if (!fresh) return { ok: false, error: "gone" };
  // Only the holder may clear it. A turn that overran and finished after its lease was
  // reclaimed must not delete the replacement's claim.
  if (fresh.activeTurn && fresh.activeTurn.messageGuid !== messageGuid) return { ok: false, error: "not_holder" };
  patchImessageChat(fresh.id, { activeTurn: null, updatedAt: nowISO() });
  return { ok: true };
}

/** Is a Lane 2 turn live on this chat right now? Read by the triage sweep, which must not
 *  judge a window the dense agent is mid-answer on. */
export function turnInFlight(chat, atMs) {
  const t = chat?.activeTurn;
  return !!(t?.startedAt && atMs - t.startedAt < TURN_LEASE_MS);
}

/* ───────────────── the inbound entry point ───────────────── */

/**
 * One inbound GROUP message, start to finish. Called from the webhook under the chat lock.
 *
 * Order matters and is not arbitrary:
 *   stop request → honoured from ANYONE, before anything else looks at who they are
 *   bound chat   → record (members only) and hand off to triage later
 *   no record    → note it pending in the one household a verified member belongs to
 *   nobody       → nothing written, nothing sent, nothing learned by anyone
 */
export async function handleInboundGroup({ msg, atMs }) {
  const chatGuid = msg.chatGuid;
  if (!chatGuid) return { ignored: "unknown_chat_context" };

  const found = await resolveGroupChat(chatGuid);

  if (found.ok) {
    const { chat, householdId } = found;
    return await runWithTenant(householdId, async () => {
      const fresh = getImessageChat(chat.id) ?? chat;
      if (isStopRequest(msg.text)) {
        // Before the membership question, deliberately: an outsider's "stop" counts.
        if (fresh.status !== "revoked") {
          const sender = resolveSmsSender(msg.address);
          /* Say goodbye FIRST, while the chat is still bound, and wipe afterwards. The
           * other order needed a fake status to get past speakToChat's own guard, and left
           * the goodbye itself sitting in the index the wipe had just emptied: a revoked
           * chat keeping one message is not a revoked chat. This way the acknowledgement is
           * recorded and then deleted with everything else, which is what "stays gone"
           * means. */
          await speakToChat({
            chat: fresh, householdId, text: "Understood — I'll stop here and won't come back.",
            kind: "revoke_ack", force: true, atMs,
          }).catch(() => ({ ok: false }));
          revokeChat({ chat: getImessageChat(fresh.id) ?? fresh, by: sender ? "member" : "participant", actorId: sender?.member?.actorId ?? null });
        }
        return { handled: true, kind: "revoked" };
      }
      if (fresh.status !== "bound") return { ignored: "chat_not_bound" };

      const sender = resolveSmsSender(msg.address);
      const rec = recordInboundGroupMessage({ chat: fresh, msg, memberId: sender?.member?.actorId ?? null, atMs });

      /* An answer to an open offer. Matched deterministically, and only ever acted on for a
       * VERIFIED, OPTED-IN member of this household — an unknown handle's "yes" executes
       * nothing and is not told why, because being told why is how a stranger learns this
       * thread belongs to a FamiliOS household. */
      const answer = classifyAffirmative(msg.text);
      if (answer) {
        const open = openProposalFor(fresh.chatGuid, atMs);
        if (open) {
          if (!sender) {
            appendAudit({ type: "imessage.affirmative_unverified", chatId: fresh.id, householdId, proposalId: open.id });
            return { handled: true, kind: "recorded", stored: rec.stored, ignoredAnswer: "sender_not_verified" };
          }
          const memberSession = { actorId: sender.member.actorId, householdId, role: sender.member.role };
          const resolved = await resolveProposal({ chat: fresh, proposal: open, answer, memberSession, atMs });
          return { handled: true, kind: resolved.ok ? `proposal_${resolved.outcome}` : "proposal_failed" };
        }
      }

      /* LANE 2 — Famili was addressed by name.
       *
       * Deliberately AFTER the stop check (an outsider's "stop" outranks everything) and
       * after the affirmative check (an open offer is a live commitment, and resolving it
       * deterministically costs nothing). In practice a wake prefix and a whole-message
       * "yes" cannot both match, but the ordering is the guarantee, not the coincidence.
       *
       * This function stays DETERMINISTIC: it decides that a turn should happen, claims the
       * lease, and hands the verdict back. The model call is kicked off by the caller,
       * outside the chat lock. */
      const wake = detectWake(msg.text);
      if (wake) {
        if (!sender) {
          /* Same rule as the unverified "yes" above: nothing runs, and they are not told
           * why. A stranger learning their wake word was refused for want of verification
           * is a stranger learning this thread belongs to a FamiliOS household. */
          appendAudit({ type: "imessage.wake_unverified", chatId: fresh.id, householdId });
          return { handled: true, kind: "recorded", stored: rec.stored, ignoredWake: "sender_not_verified" };
        }
        const lease = takeTurnLease({ chat: fresh, messageGuid: msg.guid ?? null, actorId: sender.member.actorId, atMs });
        if (!lease.ok) {
          /* Busy. Recorded, and SILENT — answering "I'm still working on the last one" into
           * a family thread is the nagging this product refuses. The audit count is how we
           * find out whether one-turn-at-a-time is actually costing anyone anything. */
          appendAudit({ type: "imessage.wake_busy", chatId: fresh.id, householdId, heldBy: lease.heldBy });
          return { handled: true, kind: "recorded", stored: rec.stored, ignoredWake: "turn_in_flight" };
        }
        if (lease.reclaimed) appendAudit({ type: "imessage.turn_lease_expired", chatId: fresh.id, householdId });
        return {
          handled: true, kind: "wake", lane: 2,
          turn: {
            chatId: fresh.id, householdId, prompt: wake.prompt,
            messageGuid: msg.guid ?? null,
            sender: { actorId: sender.member.actorId, role: sender.member.role, displayName: sender.member.displayName ?? sender.member.actorId },
          },
        };
      }

      /* A near-miss is recorded and NOT acted on: "Famili what's on Saturday?" is the most
       * natural way to address it and the strict matcher misses it on purpose. Counting them
       * is what lets the rule be widened later against a number instead of an opinion. */
      if (sender && wakeNearMiss(msg.text)) {
        putChatDecision({
          id: `cd_${crypto.randomUUID()}`, chatId: fresh.id, householdId,
          at: nowISO(), decision: "silent", reason: "wake_near_miss",
          memberMessageCount: 1, nonMemberMessageCount: 0,
        });
      }
      return { handled: true, kind: "recorded", stored: rec.stored, memberId: sender?.member?.actorId ?? null };
    });
  }

  if (found.error === "chat_ambiguous") {
    appendAudit({ type: "imessage.chat_ambiguous", chatGuid, households: found.count });
    return { ignored: "chat_ambiguous" };
  }

  const pending = await notePendingChat({ msg, atMs });
  if (!pending.ok) return { ignored: pending.error === "sender_not_a_member" ? "unknown_sender" : pending.error };
  return { ignored: "chat_not_bound", pending: true };
}

/* Registered by index.mjs at boot, rather than imported, because coordination.mjs already
 * imports this module (for the chat record, the transcript reader and the one way to speak
 * into a thread) and importing it back would close the cycle. Same idiom as
 * setHelperRunner in triggers.mjs, and for the same reason. */
let _openLoop = null;
export function setCoordinationOpener(fn) { _openLoop = typeof fn === "function" ? fn : null; }

/* ───────────────── proposals: the only thing Famili ever asks ───────────────── */

/** The proposal kinds the classifier may return, and the tool each one maps to. The MODEL
 *  never sees a tool id — it returns a kind from this enum and the server does the mapping
 *  — so it cannot name a tool it was not given, and the "I added that" confabulation that
 *  comes from handing a model a menu it will then be refused from has no way to happen. */
export const PROPOSAL_KINDS = Object.freeze({
  event: "homeops.create_event_draft",
  task: "homeops.create_task",
  list_item: "homeops.create_list_item",
});

/** What a LANE 1 proposal may become — derived from the enum above so the two cannot drift.
 *  See "the floor" at the top of this file for which surface each layer now protects.
 *  Lane 2 is deliberately NOT gated by this: it is gated by attribution. */
export const PROPOSAL_TOOL_IDS = Object.freeze(new Set(Object.values(PROPOSAL_KINDS)));

/** Phase 1b's gate, made concrete. Shadow mode is the default: the classifier runs and
 *  writes its verdicts down, and proposes nothing, until a household turns this on. The
 *  precision bar is read off the decision log before that happens, not guessed at. */
/** Does this household keep everyone's messages, or only its own members'? Default false —
 *  the setting that holds least, and the one every other household keeps. */
export function storeAllParticipants(householdId = currentTenant()) {
  return getSettings(householdId).storeAllChatParticipants === true;
}

/**
 * Tell every bound chat that the retention policy changed — BEFORE it changes.
 *
 * The announcement Famili made at bind time is a promise, and the people it was made to are
 * mostly not FamiliOS users: they cannot open an app to check, and they did not choose any
 * of this. Flipping the setting underneath that sentence turns it into a lie, which is
 * precisely the "fabricated success" this codebase refuses everywhere else.
 *
 * So the announcement is attempted first and the change only lands if every bound chat
 * heard it. Refusing a settings write because a chat is unreachable is annoying; changing
 * what is kept about someone who was told otherwise is not recoverable. bindChat already
 * takes this exact position — "a silent join is not on the menu" — and this is the same rule
 * applied to the same promise.
 *
 * @returns {Promise<{ok:boolean, announced:number, failed:Array<{chatId,displayName}>}>}
 */
export async function announceStoragePolicy({ householdId, session, storeAll, atMs = null }) {
  const at = atMs ?? Date.now();
  const bound = listImessageChats((c) => c.householdId === householdId && c.status === "bound");
  const text = storeAll
    ? `Famili here — one change to mention: from now on I keep this chat's messages so I can follow what you're arranging. Reply "Famili stop" any time and I'll leave, and everything goes with me.`
    : `Famili here — one change to mention: from now on I only keep messages from this household's own members; everyone else's stay unsaved, and what I had of them is deleted. Reply "Famili stop" any time and I'll leave.`;

  const failed = [];
  let announced = 0;
  for (const chat of bound) {
    const said = await speakToChat({ chat, householdId, session, text, kind: "policy_change", force: true, atMs: at })
      .catch(() => ({ ok: false }));
    if (said.ok) announced++;
    else failed.push({ chatId: chat.id, displayName: chat.displayName ?? "" });
  }
  return { ok: failed.length === 0, announced, failed };
}

/**
 * Drop every stored non-member message in this household's chats.
 *
 * Run when the setting goes OFF. Deleting is not optional: keeping them would mean holding
 * data under a policy the household has just withdrawn, and the chat was told it was gone.
 * Member rows and Famili's own rows are untouched — only rows with no member behind them.
 */
export function dropNonMemberMessages(householdId) {
  let dropped = 0;
  for (const chat of listImessageChats((c) => c.householdId === householdId)) {
    const buckets = chat.messageIdsByDay && typeof chat.messageIdsByDay === "object" ? chat.messageIdsByDay : {};
    const doomed = new Set();
    for (const ids of Object.values(buckets)) {
      for (const id of ids) {
        const m = getImessageMessage(id);
        // direction "out" is Famili's own voice, which also has no member behind it.
        if (m && !m.fromMemberId && m.direction !== "out") doomed.add(id);
      }
    }
    if (!doomed.size) continue;
    for (const id of doomed) if (deleteImessageMessageRec(id)) dropped++;
    const nextBuckets = {};
    for (const [day, ids] of Object.entries(buckets)) {
      const kept = ids.filter((id) => !doomed.has(id));
      if (kept.length) nextBuckets[day] = kept;
    }
    patchImessageChat(chat.id, {
      messageIdsByDay: nextBuckets,
      recentMessageIds: (Array.isArray(chat.recentMessageIds) ? chat.recentMessageIds : []).filter((id) => !doomed.has(id)),
      updatedAt: nowISO(),
    });
  }
  return { dropped };
}

export function proposalsEnabled(householdId = currentTenant()) {
  return getSettings(householdId).chatProposalsEnabled === true;
}

export const PROPOSAL_TTL_MS = 30 * 60_000; // mirrors APPROVAL_TTL_MS: a stale offer must not execute
const proposalId = () => "prp_" + crypto.randomBytes(8).toString("hex");

/** The one open offer for a chat, if it is still open and still fresh. */
export function openProposalFor(chatGuid, nowMs) {
  const rows = listChatProposals((p) => p.chatGuid === chatGuid && p.status === "open");
  for (const p of rows) {
    if (Date.parse(p.expiresAt ?? "") > nowMs) return p;
  }
  return null;
}

const OFFER_TEXT = {
  event: (t) => `Famili here. Want me to put "${t}" on the family calendar?`,
  task: (t) => `Famili here. Want me to add "${t}" to the family's tasks?`,
  list_item: (t) => `Famili here. Want me to add "${t}" to the shopping list?`,
};

/**
 * Make one offer into the chat, and record what a yes would do.
 *
 * At most one open proposal per chat, enforced by the caller's chat lock. The span is
 * stored as the MEMBER message it was found in plus the text of that member's message, so
 * nothing a non-member wrote is copied into a durable record even indirectly.
 */
export async function openProposal({ chat, kind, title, details, spanMemberId, atMs, decisionId = null }) {
  const toolId = PROPOSAL_KINDS[kind];
  if (!toolId) return { ok: false, error: "invalid_input", message: "Not a proposal kind." };
  if (!PROPOSAL_TOOL_IDS.has(toolId)) return { ok: false, error: "tool_not_in_group_scope", message: "That action isn't in the group surface." };
  if (!proposalsEnabled(chat.householdId)) return { ok: false, error: "proposals_disabled" };
  if (openProposalFor(chat.chatGuid, atMs)) return { ok: false, error: "proposal_already_open" };

  const clean = String(title ?? "").trim().slice(0, 120);
  if (!clean) return { ok: false, error: "invalid_input", message: "Nothing to propose." };

  const said = await speakToChat({ chat, householdId: chat.householdId, text: (OFFER_TEXT[kind] ?? OFFER_TEXT.task)(clean), kind: "proposal", atMs });
  if (!said.ok) return { ok: false, error: said.error, message: said.message };

  const rec = putChatProposal({
    id: proposalId(), householdId: chat.householdId, chatGuid: chat.chatGuid,
    toolId, kind, title: clean, input: buildToolInput(kind, clean, details),
    spanMemberId: spanMemberId ?? null, requestedByActorId: spanMemberId ?? null, decisionId,
    status: "open", proposedAt: new Date(atMs).toISOString(),
    expiresAt: new Date(atMs + PROPOSAL_TTL_MS).toISOString(),
    decidedBy: null, decidedAt: null, runId: null, loopId: null,
  });
  appendAudit({ type: "imessage.proposed", chatId: chat.id, householdId: chat.householdId, proposalId: rec.id, kind });
  return { ok: true, proposal: rec };
}

/** Map a kind plus the classifier's details onto the tool's declared input keys. The
 *  server owns this mapping; a model-supplied key that is not named here is dropped. */
function buildToolInput(kind, title, details = {}) {
  if (kind === "event") {
    return {
      title, startAt: details?.startAt ? String(details.startAt) : null,
      location: typeof details?.location === "string" ? details.location : "",
      visibility: "household",
    };
  }
  if (kind === "task") {
    return { title, dueAt: details?.dueAt ? String(details.dueAt) : null, visibility: "household" };
  }
  return { text: String(details?.text ?? title), listName: typeof details?.listName === "string" ? details.listName : "Shopping", visibility: "household" };
}

/** Yes and no, matched deterministically before any model is consulted. The precedent is
 *  classifySmsKeyword: a whole-message match, because "no, not that one, the other thing"
 *  is not an answer and treating it as one is how a chatbot becomes unbearable. */
const YES_RE = /^(y|ya|yes|yeah|yep|yup|sure|ok|okay|please|please do|do it|go ahead|sounds good|👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿)[.!]?$/i;
const NO_RE = /^(n|no|nope|nah|no thanks|no thank you|don'?t|do not|leave it|not now|cancel)[.!]?$/i;
export function classifyAffirmative(text) {
  const t = String(text ?? "").trim();
  if (!t || t.length > 30) return null;
  if (YES_RE.test(t)) return "yes";
  if (NO_RE.test(t)) return "no";
  return null;
}

/**
 * Answer an open proposal.
 *
 * The reply must come from a VERIFIED, OPTED-IN member of the bound household. An unknown
 * handle saying "yes" executes nothing, ever, and is not told why: a stranger learning
 * that their yes was refused for want of verification is a stranger learning this thread
 * belongs to a FamiliOS household.
 *
 * Execution goes through executeToolForChat with the chat helper's identity, which is what
 * makes isToolStepAllowed and resolveEffectivePolicy both run. Nothing here re-implements
 * a gate; a needs-approval verdict becomes a parked run in the family's existing Inbox.
 */
export async function resolveProposal({ chat, proposal, answer, memberSession, atMs }) {
  if (proposal.status !== "open") return { ok: false, error: "proposal_already_taken", message: "Someone already answered this one." };
  if (Date.parse(proposal.expiresAt ?? "") <= atMs) {
    patchChatProposal(proposal.id, { status: "expired", decidedAt: new Date(atMs).toISOString() });
    return { ok: false, error: "proposal_expired", message: "That offer timed out — ask again and I'll pick it up." };
  }

  if (answer === "no") {
    patchChatProposal(proposal.id, { status: "refused", decidedBy: memberSession.actorId, decidedAt: new Date(atMs).toISOString() });
    appendAudit({ type: "imessage.proposal_refused", chatId: chat.id, householdId: chat.householdId, proposalId: proposal.id });
    // Acknowledged once, then out of the thread. What happens next is the coordination
    // loop's business, and it is deliberately not the group's.
    await speakToChat({ chat, householdId: chat.householdId, text: "No problem.", kind: "refusal_ack", atMs }).catch(() => ({ ok: false }));
    /* A refusal about something someone ELSE raised does not simply evaporate: it becomes a
     * quiet record that will check the calendar in a day or two and, if nothing came of it,
     * ask this person once in private. A refusal of one's own suggestion is just a no. */
    const raisedBySomeoneElse = proposal.requestedByActorId && proposal.requestedByActorId !== memberSession.actorId;
    if (raisedBySomeoneElse && _openLoop) {
      try {
        _openLoop({ chat, proposal, requestedByActorId: proposal.requestedByActorId, targetActorId: memberSession.actorId, nowMs: atMs });
      } catch { /* a loop that cannot open must not undo a refusal that already landed */ }
    }
    return { ok: true, outcome: "refused", proposal: getChatProposal(proposal.id) };
  }

  if (!PROPOSAL_TOOL_IDS.has(proposal.toolId)) {
    // The call-site floor. A stored proposal cannot widen what this surface may reach,
    // whatever the helper record says, because this Set is code rather than data.
    appendAudit({ type: "imessage.tool_out_of_scope", chatId: chat.id, householdId: chat.householdId, toolId: proposal.toolId });
    return { ok: false, error: "tool_not_in_group_scope", message: "That isn't something I can do here." };
  }
  const usable = chatHelperUsable();
  if (!usable.ok) return usable;

  const out = await executeToolForChat({
    toolId: proposal.toolId, input: proposal.input,
    session: memberSession, agent: usable.agent, conversationId: null,
  });

  if (out.needsApproval) {
    const q = await queueApprovalRun({
      toolId: proposal.toolId, input: proposal.input, title: proposal.title,
      session: memberSession, conversationId: null, goal: proposal.title, visibility: "household",
      // Truthful provenance. An approval that reads "Asked in chat" when it came from the
      // family's group thread is a false system state in the one surface where honesty
      // decides whether the action happens at all.
      source: "group_chat", via: "group_chat", summaryPrefix: "Asked in the family chat",
    });
    patchChatProposal(proposal.id, { status: "accepted", decidedBy: memberSession.actorId, decidedAt: new Date(atMs).toISOString(), runId: q.runId ?? null });
    await speakToChat({ chat, householdId: chat.householdId, text: "I've put that in front of the adults to approve — nothing's changed yet.", kind: "approval_notice", atMs }).catch(() => ({ ok: false }));
    return { ok: true, outcome: "awaiting_approval", runId: q.runId ?? null };
  }

  if (!out.ok) {
    patchChatProposal(proposal.id, { status: "refused", decidedBy: memberSession.actorId, decidedAt: new Date(atMs).toISOString() });
    appendAudit({ type: "imessage.proposal_failed", chatId: chat.id, householdId: chat.householdId, proposalId: proposal.id, error: out.error });
    await speakToChat({ chat, householdId: chat.householdId, text: `I couldn't do that: ${out.message ?? out.error}`, kind: "failure", atMs }).catch(() => ({ ok: false }));
    return { ok: false, error: out.error, message: out.message };
  }

  patchChatProposal(proposal.id, { status: "executed", decidedBy: memberSession.actorId, decidedAt: new Date(atMs).toISOString() });
  appendAudit({ type: "imessage.proposal_executed", chatId: chat.id, householdId: chat.householdId, proposalId: proposal.id, toolId: proposal.toolId });
  await speakToChat({ chat, householdId: chat.householdId, text: `Done — "${proposal.title}" is in.`, kind: "confirmation", atMs }).catch(() => ({ ok: false }));
  /* THE PICTURE NEVER GATES THE CONFIRMATION. The words went first and they carry the whole
   * meaning; this is evidence on top of them. The renderer behind it lives on a free plan
   * that spins down and takes the better part of a minute to wake, so a confirmation that
   * waited for it would be a confirmation that arrived late. Failure here is silent by
   * design: we never promise a picture, so there is nothing to apologise for. */
  void sendVisualProof({ chat, proposal, result: out.result, memberSession, atMs }).catch(() => {});
  return { ok: true, outcome: "executed", result: out.result };
}

/* ───────────────── visual proof ───────────────── */

/** What a proposal's tool result points at, in the vocabulary share-preview speaks. */
function previewRefFor(kind, result) {
  const r = result ?? {};
  if (kind === "event") return r.id ? { type: "event", id: String(r.id) } : null;
  if (kind === "task") return r.id ? { type: "task", id: String(r.id) } : null;
  if (kind === "list_item") return r.id ? { type: "list_item", id: String(r.id) } : null;
  return null;
}

/**
 * Render the card the family would see in the app and send it as a picture.
 *
 * Every step degrades to silence. No browser runtime, a cold one, a bridge that does not
 * take attachments, a record that cannot be previewed: in each case the written
 * confirmation already went, and nothing here says otherwise. The one thing this must
 * never do is announce that a picture is coming.
 */
export async function sendVisualProof({ chat, proposal, result, memberSession, atMs }) {
  const ref = previewRefFor(proposal.kind, result);
  if (!ref) return { ok: false, error: "no_preview_ref" };

  const minted = mintPreviewToken({
    householdId: chat.householdId, actorId: memberSession.actorId, role: memberSession.role,
    type: ref.type, id: ref.id, nowMs: atMs,
  });
  if (!minted.ok) return { ok: false, error: minted.error };

  const publicUrl = String(process.env.HOMEOPS_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!publicUrl) return { ok: false, error: "render_unavailable" }; // nothing to point a browser at

  const shot = await screenshotPage(`${publicUrl}/api/preview/card?t=${encodeURIComponent(minted.token)}`);
  if (!shot.ok) {
    appendAudit({ type: "imessage.proof_skipped", chatId: chat.id, householdId: chat.householdId, error: shot.error });
    return { ok: false, error: shot.error };
  }
  const sent = await sendAttachment({ chatGuid: chat.chatGuid, filename: "familios-card.png", mime: "image/png", bytes: shot.bytes });
  if (!sent.ok) {
    appendAudit({ type: "imessage.proof_skipped", chatId: chat.id, householdId: chat.householdId, error: sent.error });
    return { ok: false, error: sent.error === "not_configured" ? "attachment_unsupported" : sent.error };
  }
  appendAudit({ type: "imessage.proof_sent", chatId: chat.id, householdId: chat.householdId, proposalId: proposal.id });
  return { ok: true };
}

/** The lock every group write takes. NO tenant prefix, and that is not an oversight: at
 *  claim time the webhook has not called gate(), so currentTenant() is the resident
 *  household for every delivery and a prefix would be a constant. Chat GUIDs are
 *  deployment-global, so the GUID alone is the honest key. withLock is in-process only
 *  (store.mjs) — single-process Node, which is the assumption the rest of this codebase
 *  already runs on. */
export function withChatLock(chatGuid, fn) {
  return withLock(`chat:${chatGuid}`, fn);
}
