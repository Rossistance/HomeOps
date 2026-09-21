// FamiliOS — the part that stays quiet.
//
// A classifier reads the family's group chat and almost always decides to say nothing. The
// whole design is about making that silence trustworthy and making the exceptions rare.
//
// ── Why it is a SWEEP and not a timer ──────────────────────────────────────────────────
// Debounce state lives on the chat record as a timestamp, not in a setTimeout. A restart
// loses every in-flight timer, and this deployment restarts on every deploy; the failure
// mode of a lost timer is "the message that never came", which leaves no trace and cannot
// be debugged afterwards. A swept timestamp resumes on the next tick. This is the same
// idiom reminders.mjs uses, for the same reason.
//
// ── Why the model never names a tool ───────────────────────────────────────────────────
// It returns a KIND from a fixed enum and the server maps it to a tool id. Two reasons.
// The allow-list cannot reach the native famili.* tools at all (they are registered in a
// second loop with no permitted-ids check and executed directly), and every homeops.* tool
// is forced into the model's menu regardless of any allow-list (isAlwaysAvailableTool). A
// model handed a menu it will then be refused from writes "I added that" about things it
// did not add — which is precisely the machinery-narrating failure the seven-concepts
// collapse was written about. The cleanest fix is to hand it no menu.
//
// ── Why silence is written down ────────────────────────────────────────────────────────
// A negative-bias prompt fails ASYMMETRICALLY: a false positive is loud and embarrassing,
// a false negative produces nothing at all — no artifact, no log line, no complaint. The
// family simply never discovers the feature works. So every verdict is recorded, including
// the empty ones, and precision becomes measurable instead of felt.
import crypto from "node:crypto";
import {
  forEachTenant, appendAudit, getSettings, getMember,
  listImessageChats, getImessageChat, patchImessageChat,
  putChatDecision, listChatDecisions, deleteChatDecisionRec,
  recordAiUsage, kindBudgetExhausted,
} from "./store.mjs";
import { providerChatJSON } from "./ai.mjs";
import { triageTier, TRIAGE_USAGE_KIND, DEFAULT_TRIAGE_DAILY_BUDGET } from "./ai-tier.mjs";
import { householdTimeZone } from "./household-time.mjs";
import {
  chatHelperUsable, readWindow, recentMessages, pruneChatTranscript, withChatLock,
  PROPOSAL_KINDS, openProposal, proposalsEnabled,
} from "./group-chat.mjs";

/** How long a chat must be quiet before the window is judged. A burst of ten messages
 *  costs ONE model call, not ten — the unit of judgement is the conversation, not the
 *  line, which is also the only way a request split across three messages is legible. */
export const QUIET_GAP_MS = 45_000;
/** …and how long after that we stop bothering. A conversation from yesterday is not a
 *  pending decision; judging it now would surface a proposal about a settled thing. */
export const STALE_WINDOW_MS = 2 * 60 * 60_000;
const DECISION_RETENTION_DAYS = 45;
const MAX_CHATS_PER_PASS = 12;

const decisionId = () => "cdx_" + crypto.randomBytes(8).toString("hex");
const nowISO = () => new Date().toISOString();

export { PROPOSAL_KINDS };

const SYS = `You are reading a family's own group chat. You are a silent observer. Almost always you say nothing.

Reply with JSON only, no prose, no code fences:
{"decision":"silent"|"propose","reason":"one short clause","kind":"event"|"task"|"list_item"|null,"title":"...","span":"the exact words that settle it, copied verbatim","details":{...}}

THE DEFAULT IS SILENCE. "silent" is the correct answer to almost every window you will ever see. Reply "propose" ONLY when every one of these is true:
- The family has SETTLED something, not raised it. A question, an option, a maybe, a negotiation in progress, or one person thinking aloud is NOT settled.
- A second person has agreed, or someone has stated it as a decision or an instruction.
- It is LOGISTICAL: a dated commitment, a chore someone will do, or an item for a shared list.
- You can quote the exact words that settle it, copied character for character from a message in the window. If you cannot quote it, you are not sure, and the answer is "silent".

Never propose about: feelings, opinions, health details someone has not asked for help with, plans involving people outside this family, anything already discussed and dropped, or anything you are inferring rather than reading.
Never invent a date, a time, a place or a person. If a detail is missing, stay silent rather than guessing it.
"details" for event: {"title","startAt" (ISO 8601 or YYYY-MM-DD),"location"}. For task: {"title","dueAt"}. For list_item: {"text","listName"}.
Times are in the household's timezone. Resolve "tomorrow" and "Friday" against TODAY.`;

/** Test-only extractor: a bracketed directive in the text drives the whole path with no
 *  model, exactly as HOMEOPS_SUGGEST_FAKE does for message suggestions. Without this the
 *  proposal path can only be exercised against a live provider, which means in practice it
 *  is never exercised at all. */
function fakeJudge(windowText) {
  const m = windowText.match(/\[propose (event|task|list_item):\s*([^\]|]+)(?:\|span=([^\]|]+))?(?:\|when=([^\]|]+))?\]/i);
  if (!m) return { decision: "silent", reason: "no directive", kind: null, title: "", span: "", details: {} };
  const [, kind, title, span, when] = m;
  return {
    decision: "propose", reason: "test directive", kind, title: title.trim(),
    span: (span ?? m[0]).trim(),
    details: kind === "list_item" ? { text: title.trim(), listName: "Shopping" }
      : kind === "task" ? { title: title.trim(), dueAt: when?.trim() ?? null }
        : { title: title.trim(), startAt: when?.trim() ?? null },
  };
}

/** Render the window for the prompt, and keep the member/non-member split visible to the
 *  audit even though the model sees both. */
function renderWindow(items) {
  return items.map((it) => `${it.isMember ? (getMember(it.memberId)?.displayName ?? "member") : "someone else"}: ${it.text}`).join("\n");
}

/** A window digest over MEMBER-VISIBLE text only. This is what precision is later judged
 *  against — non-member text was deliberately never kept, so a digest including it could
 *  not be reproduced from the database and would imply an audit that cannot be done. */
function windowDigest(items) {
  const memberText = items.filter((i) => i.isMember).map((i) => i.text).join("\n");
  return crypto.createHash("sha256").update(memberText).digest("hex").slice(0, 16);
}

/**
 * THE SPAN GUARD, and it does two jobs at once.
 *
 * A model can hallucinate the very quote it offers as evidence, so the span is checked to
 * exist verbatim. And it is checked only against MEMBER messages, which makes the
 * third-party rule a production guard rather than a metric someone reads later: a proposal
 * whose settling words came from a non-member cannot be made, and nothing a non-member
 * wrote is copied into a durable proposal record.
 */
export function verifySpan(span, items) {
  const needle = String(span ?? "").trim();
  if (!needle || needle.length < 4) return { ok: false, error: "span_not_found" };
  const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const hay = needle.length > 400 ? needle.slice(0, 400) : needle;
  for (const it of items) {
    if (!it.isMember) continue;
    if (norm(it.text).includes(norm(hay))) return { ok: true, memberId: it.memberId, text: it.text };
  }
  return { ok: false, error: "span_not_found" };
}

/** One triage pass over one chat, in the current tenant. Never throws. */
export async function triageChat({ chat, nowMs }) {
  const items = readWindow(chat.chatGuid, nowMs);
  const durable = recentMessages(chat, 12);
  // The window is what the classifier sees; if the in-memory half is gone (a restart), the
  // durable member-only half still gives it something real rather than nothing.
  const merged = items.length
    ? items
    : durable.map((m) => ({ text: m.text, memberId: m.fromMemberId, isMember: !!m.fromMemberId, atMs: Date.parse(m.at) }));
  if (!merged.length) return { decision: "skipped", reason: "empty_window" };
  if (!merged.some((i) => i.isMember)) return { decision: "skipped", reason: "no_member_context" };

  const base = {
    id: decisionId(), householdId: chat.householdId, chatGuid: chat.chatGuid, at: nowISO(),
    windowDigest: windowDigest(merged),
    memberMessageCount: merged.filter((i) => i.isMember).length,
    nonMemberMessageCount: merged.filter((i) => !i.isMember).length,
    decision: "silent", reason: "", kind: null, spanVerified: false, spanMemberId: null,
    model: null, providerId: null, latencyMs: 0, degraded: false,
  };

  const fake = process.env.HOMEOPS_GROUP_FAKE === "1" && process.env.NODE_ENV !== "production";
  let judged = null;
  let providerId = null; let model = null; let latencyMs = 0;

  if (fake) {
    judged = fakeJudge(merged.map((i) => i.text).join("\n"));
    providerId = "fake"; model = "fake";
  } else {
    const tier = triageTier(chat.householdId);
    if (!tier.ok) {
      putChatDecision({ ...base, decision: "silent", reason: tier.error });
      return { decision: "skipped", reason: tier.error };
    }
    const budget = Number(getSettings(chat.householdId).aiTriageDailyBudget ?? DEFAULT_TRIAGE_DAILY_BUDGET);
    if (kindBudgetExhausted(chat.householdId, TRIAGE_USAGE_KIND, budget)) {
      putChatDecision({ ...base, decision: "silent", reason: "triage_budget_exhausted" });
      return { decision: "skipped", reason: "triage_budget_exhausted" };
    }
    providerId = tier.providerId; model = tier.model;
    const t0 = Date.now();
    // Metered per HTTP attempt, and OFF `.total` — see recordAiUsage. Recorded BEFORE the
    // call so a provider that hangs still costs a tick against the ceiling; a meter that
    // only counts successes is not a ceiling.
    recordAiUsage(chat.householdId, TRIAGE_USAGE_KIND, { countsTowardTotal: false });
    // providerChat directly, NEVER providerChatWithFallback: that helper walks every
    // configured provider on a transient failure and drops the per-call model, so a
    // Groq-intended classification would land on the household's frontier key at its
    // default model. The no-fallback rule has to hold from both directions.
    const out = await providerChatJSON(providerId, {
      model,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: `TODAY: ${nowISO()} (timezone ${householdTimeZone(chat.householdId)})\nCONVERSATION (oldest first):\n${renderWindow(merged)}` },
      ],
    }).catch(() => ({ ok: false, error: "triage_unavailable" }));
    latencyMs = Date.now() - t0;
    if (!out.ok) {
      putChatDecision({ ...base, decision: "silent", reason: out.error ?? "triage_unavailable", providerId, model, latencyMs });
      // The cursor is NOT advanced by the caller on this path: an unavailable provider is a
      // window still owed a verdict, not a window judged silent.
      return { decision: "skipped", reason: "triage_unavailable" };
    }
    judged = out.json;
  }

  const wantsPropose = judged?.decision === "propose" && PROPOSAL_KINDS[judged?.kind];
  if (!wantsPropose) {
    putChatDecision({ ...base, decision: "silent", reason: String(judged?.reason ?? "").slice(0, 120), providerId, model, latencyMs });
    return { decision: "silent" };
  }

  const span = verifySpan(judged.span, merged);
  if (!span.ok) {
    putChatDecision({ ...base, decision: "silent", reason: "span_not_found", kind: judged.kind, providerId, model, latencyMs });
    appendAudit({ type: "imessage.triage_span_rejected", chatId: chat.id, householdId: chat.householdId, kind: judged.kind });
    return { decision: "silent", reason: "span_not_found" };
  }

  const decision = {
    ...base, decision: "propose", reason: String(judged.reason ?? "").slice(0, 120),
    kind: judged.kind, spanVerified: true, spanMemberId: span.memberId,
    providerId, model, latencyMs,
  };
  putChatDecision(decision);
  return {
    decision: "propose", kind: judged.kind, title: String(judged.title ?? "").slice(0, 160),
    details: judged.details ?? {}, span: span.text, spanMemberId: span.memberId, decisionId: decision.id,
  };
}

/**
 * Sweep every bound chat whose window has gone quiet. Returns what it did so a caller can
 * audit it. NEVER THROWS — one household's bad record must not stop the sweep for the rest,
 * and unlike forEachTenant (which swallows silently) a failure here is written down, so a
 * sweep that is failing for everyone does not look like one with nothing to do.
 *
 * WRITES NOTHING WHEN NOTHING IS DUE. The CI data-isolation job boots a real server on
 * server/.data, hashes it, runs the suite beside it and requires the directory byte
 * identical afterwards. An idle household must therefore produce no write at all — no
 * cursor stamp, no seeding, no deferred first pass.
 */
export async function sweepGroupTriage(nowMs = null) {
  const now = nowMs ?? Date.now();
  const out = { checked: 0, judged: 0, proposed: 0, pruned: 0, skipped: 0 };
  let chats;
  try {
    chats = listImessageChats((c) => c.status === "bound");
  } catch { return out; }
  if (!chats.length) return out;

  const helper = chatHelperUsable();
  if (!helper.ok) {
    // R1's third layer. An emptied allow-list makes this helper PERMISSIVE, not
    // restrictive, so the listener stops rather than acting with more reach than intended.
    appendAudit({ type: "chat.triage_failed", error: helper.error, householdId: chats[0]?.householdId ?? null });
    out.skipped = chats.length;
    return out;
  }

  for (const chat of chats.slice(0, MAX_CHATS_PER_PASS)) {
    try {
      const lastMs = Date.parse(chat.lastMessageAt ?? "");
      if (!Number.isFinite(lastMs)) { out.skipped++; continue; }
      const cursorMs = Date.parse(chat.triageCursorAt ?? "");
      const unjudged = !Number.isFinite(cursorMs) || cursorMs < lastMs;
      const quiet = now - lastMs >= QUIET_GAP_MS;
      const stale = now - lastMs > STALE_WINDOW_MS;

      // Retention first, and only when a bucket has actually expired — pruneChatTranscript
      // returns without writing otherwise.
      const pr = pruneChatTranscript(chat, now);
      out.pruned += pr.dropped;

      if (!unjudged || !quiet) { out.checked++; continue; }
      if (stale) {
        // Judging yesterday's conversation would surface a proposal about a settled thing.
        // Advance past it; that IS a state change, so it is a legitimate write.
        patchImessageChat(chat.id, { triageCursorAt: new Date(lastMs).toISOString(), updatedAt: nowISO() });
        out.skipped++;
        continue;
      }

      out.checked++;
      const verdict = await withChatLock(chat.chatGuid, async () => {
        const fresh = getImessageChat(chat.id) ?? chat;
        const v = await triageChat({ chat: fresh, nowMs: now });
        /* SHADOW MODE IS THE DEFAULT. The classifier runs and writes its verdict down; it
         * proposes nothing until a household turns proposals on. The precision bar is read
         * off the decision log BEFORE that happens rather than guessed at, which is only
         * possible because silence is recorded too. */
        if (v.decision === "propose" && proposalsEnabled(fresh.householdId)) {
          const made = await openProposal({
            chat: fresh, kind: v.kind, title: v.title, details: v.details,
            spanMemberId: v.spanMemberId ?? null, atMs: now, decisionId: v.decisionId ?? null,
          });
          return { ...v, proposed: made.ok, proposalError: made.ok ? null : made.error };
        }
        return v;
      });
      if (verdict.decision === "skipped" && verdict.reason === "triage_unavailable") continue; // still owed a verdict
      patchImessageChat(chat.id, { triageCursorAt: new Date(lastMs).toISOString(), lastTriagedAt: nowISO(), updatedAt: nowISO() });
      out.judged++;
      if (verdict.proposed) out.proposed++;
    } catch (e) {
      appendAudit({ type: "chat.triage_failed", chatId: chat.id, householdId: chat.householdId, error: String(e?.message ?? e).slice(0, 200) });
      out.skipped++;
    }
  }
  return out;
}

/** Decision-log retention, on the same never-write-when-idle rule. */
export function pruneChatDecisions(nowMs = null) {
  const now = nowMs ?? Date.now();
  const cutoff = now - DECISION_RETENTION_DAYS * 86400000;
  let old;
  try { old = listChatDecisions((d) => Date.parse(d.at ?? "") < cutoff); } catch { return { dropped: 0 }; }
  let dropped = 0;
  for (const d of old) { if (deleteChatDecisionRec(d.id)) dropped++; }
  return { dropped };
}

/** Run the triage sweep for every household. The per-tenant wrapper forEachTenant provides
 *  swallows errors bare, which is why sweepGroupTriage audits its own failures inside the
 *  tenant rather than relying on the loop to report them. */
export async function sweepGroupTriageAllTenants(nowMs = null) {
  await forEachTenant(async () => { await sweepGroupTriage(nowMs); });
}
