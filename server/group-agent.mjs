// FamiliOS — Lane 2: Famili answering when the family actually addressed it.
//
// Lane 1 (group-triage.mjs) is Famili OVERHEARING: an 8B classifier reads the window, is
// told to stay silent, and at most offers a one-line proposal from a three-value enum. That
// is the right shape for uninvited speech and the wrong shape for a question.
//
// This is the other lane. Someone said its name, so it answers — with the same dense
// ToolLoopAgent and the same full tool catalog the app's "Ask Famili" uses. Nothing here
// narrows what the MODEL may do; the narrowing is entirely about WHERE THE ANSWER IS READ:
//
//   • channel "group"  → the household's SHARED calendar, tasks, lists and meals only.
//     Anyone's private items are absent, from the context blob AND from every native tool
//     (store.mjs canSeeEntityInChannel). A member who wants their own data asks in a 1:1
//     text, where the audience is one person.
//   • agt_household    → the turn is ATTRIBUTED, so engine.mjs runs the whole policy ladder:
//     allow-list, kill switch, risk overrides, and the actor's own standing.
//   • role degradation → a Limited Member's request is drafted and parked for an adult
//     rather than executed (policy.mjs rule 4b). Nothing is blocked; it waits for a
//     signature.
//
// WHY THIS RUNS OUTSIDE THE CHAT LOCK. A dense turn can take minutes. Held under
// withChatLock it would block every other message in the chat for the duration — including
// "Famili stop", the one message that must never wait — stall the triage sweep's sequential
// pass, and make a re-delivery's dedupe check queue behind the very turn it exists to
// short-circuit. So the webhook claims the message and takes a durable lease under the lock
// in milliseconds, answers 200, and calls this afterwards. The lease is released here.
//
// THE INJECTION SURFACE THIS OPENS, STATED PLAINLY. A dense model with real tools now reads
// text written by people outside the household. Three things stand between that and harm:
// only a verified member can START a turn; the system prompt names outsider lines as
// reported speech and never instructions; and — the only one that actually holds — every
// consequential tool call still goes through the approval ladder, so the worst outcome of a
// successful injection is a DRAFTED, PARKED action an adult has to sign. The first two
// reduce the odds. The third is the guarantee. Do not weaken the third to make the lane
// feel snappier.
import {
  runWithTenant, getImessageChat, appendAudit, getMember,
} from "./store.mjs";
import { runAssistantAgent } from "./assistant-agent.mjs";
import { resolveActingHelper } from "./orchestrator.mjs";
import {
  mergedWindow, speakToChat, releaseTurnLease, withChatLock,
} from "./group-chat.mjs";

/* Tighter than the 1:1 cap (1500). A group thread is shared, everyone's notifications fire,
 * and a wall of text from the assistant is the "noisy chatbot" failure this feature is
 * built to avoid. */
const GROUP_REPLY_MAX = 700;

const clamp = (text) => {
  const t = String(text ?? "").trim();
  if (!t) return "";
  return t.length > GROUP_REPLY_MAX ? t.slice(0, GROUP_REPLY_MAX - 1) + "…" : t;
};

/** What the model is told when it cannot think. One honest sentence, never a stack trace. */
function failureText(out) {
  if (out?.error === "no_provider") return "I can't think right now — no AI provider is connected. An adult can add one in Settings.";
  if (out?.error === "ai_budget_exhausted") return "That's my AI budget for today — it resets at midnight. An adult can raise it in Settings.";
  return null; // everything else: say nothing rather than narrate machinery into a family thread
}

/**
 * Turn the shared window into chat history.
 *
 * Non-member lines are LABELLED, not removed: the model needs them to understand what the
 * family is talking about, and the system prompt tells it they are reported speech rather
 * than instructions. The label is the hook that rule hangs on, so it is not decorative.
 * Famili's own past messages come back as assistant turns.
 */
export function historyFromWindow(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const text = String(it?.text ?? "").trim();
    if (!text) continue;
    if (it.isSelf) { out.push({ role: "assistant", text }); continue; }
    const who = it.isMember
      ? (getMember(it.memberId)?.displayName ?? "A member of the household")
      : "someone outside the household";
    out.push({ role: "user", text: `(${who}): ${text}` });
  }
  return out;
}

/**
 * Run one Lane 2 turn and speak the answer into the thread.
 *
 * Never throws: the webhook has already answered 200 and nothing upstream is listening.
 * Always releases the lease.
 *
 * @returns {Promise<{ok:boolean, kind?:string, error?:string}>}
 */
export async function runWakeTurn({ chatId, householdId, prompt, messageGuid, sender, atMs }) {
  const at = atMs ?? Date.now();
  return await runWithTenant(householdId, async () => {
    const chat = getImessageChat(chatId);
    if (!chat) return { ok: false, error: "chat_gone" };
    try {
      // Re-read under the tenant: the chat may have been revoked between the claim and here
      // (a "Famili stop" arriving mid-turn is exactly the case the split lock exists for).
      if (chat.status !== "bound") return { ok: false, error: "chat_not_bound" };

      const session = {
        actorId: sender.actorId,
        actorName: sender.displayName ?? sender.actorId,
        role: sender.role,
        householdId,
      };

      /* A bare wake — someone said the name and nothing else. Answered without a model call:
       * it is a liveness probe, and handing an empty message to the agent produces its
       * "I'm not sure how to help with that yet" fallback, which reads as broken. */
      const ask = String(prompt ?? "").trim();
      if (!ask) {
        await speakToChat({ chat, householdId, session, text: "I'm here — what do you need?", kind: "answer", budget: "answer", atMs: at })
          .catch(() => ({ ok: false }));
        return { ok: true, kind: "bare_wake" };
      }

      const history = historyFromWindow(mergedWindow(chat, at));
      const out = await runAssistantAgent({
        message: ask,
        session,
        agent: resolveActingHelper({ session }),
        history,
        conversationId: null,
        visibility: "household",
        channel: "group",
        /* A group thread is read by everyone in it (ADR-005): an owner still hears their own
         * hidden events in full here — asking counts as consent — but never a surprise. */
        audience: "shared",
        ledger: {},
      });

      const text = out.ok ? clamp(out.answer) : clamp(failureText(out));
      if (!text) {
        appendAudit({ type: "imessage.wake_turn", chatId, householdId, ok: false, error: out.error ?? "empty_answer" });
        return { ok: false, error: out.error ?? "empty_answer" };
      }

      const said = await speakToChat({ chat: getImessageChat(chatId) ?? chat, householdId, session, text, kind: "answer", budget: "answer", atMs: at })
        .catch(() => ({ ok: false, error: "send_failed" }));
      appendAudit({
        type: "imessage.wake_turn", chatId, householdId, ok: !!said.ok,
        actorId: sender.actorId, toolCalls: out.toolCalls?.length ?? 0,
        error: said.ok ? undefined : (said.error ?? null),
      });
      return { ok: !!said.ok, kind: "answered" };
    } catch (e) {
      appendAudit({ type: "imessage.wake_turn", chatId, householdId, ok: false, error: String(e?.message ?? e).slice(0, 200) });
      return { ok: false, error: "turn_failed" };
    } finally {
      /* Under a SHORT lock, and guarded by the guid inside releaseTurnLease: a turn that
       * overran its lease and finished after a replacement claimed the chat must not delete
       * the replacement's claim. */
      await withChatLock(chat.chatGuid, async () => releaseTurnLease({ chat, messageGuid })).catch(() => {});
    }
  });
}
