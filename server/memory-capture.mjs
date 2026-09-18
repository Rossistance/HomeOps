// Memory that actually gets made.
//
// "There's no memories being generated. I'm not sure what's going on with memories, but it
//  seems to be entirely broken or non-existent throughout the application and every profile."
//
// He's right, and the reason is structural: the ONLY writer was engine.mjs's post-run judge,
// which fires when a multi-step run completes. Almost nothing a family does all day is a run —
// it's conversation. So the storage worked, the search worked, the screen worked, and the
// answer was permanently empty because nothing upstream ever wrote.
//
// This module is the missing writer: after a successful assistant exchange, a cheap second
// pass asks whether the exchange revealed something DURABLE (a preference, a fact, a routine)
// and stores it if so. Fire-and-forget by contract — a memory is a bonus, and no failure here
// may ever surface as a failure of the chat that triggered it.
//
// PRIVACY IS SCOPE-SHAPED. A memory inherits the room it was said in:
//   personal chat  → scope "personal", visible to its author alone (not admins — see the
//                    /api/memory filter; "Just me" means just me everywhere now)
//   nest chat      → scope "nest" + nestId, visible to that nest
//   family chat    → scope "household"
// A fact volunteered in a private chat surfacing in the family view would be the artifacts
// bug all over again, one layer down.
//
// AND THE ROOM IS NOT THE WHOLE STORY. Something said in the family chat can still be about
// one person — a medication, a diagnosis, a salary, a private worry. "I have a Nest thermostat"
// is the house's; "my Repatha injection is Sundays" is Ross's, wherever it was said. So the
// judge also answers WHO a memory is about and whether it is sensitive, and a personal or
// sensitive fact is stored as that person's alone even in a household room — and they are
// told it was kept, so a memory they did not intend can be removed. Memories the helpers
// gather (runHelper calls this too) follow the same rule.
import { providerChat } from "./ai.mjs";
import { activeProviderId } from "./context.mjs";
import { addMemory, listMemory, appendAudit, recordAiUsage, aiBudgetExhausted, addNotification, getMember, getAgent } from "./store.mjs";

const CAPTURE_SYS = `You watch one exchange between a family member (or one of the household's helpers) and the household assistant. Decide if it revealed something DURABLE about the household worth remembering for future conversations: a stable preference, a fact about a person or the home, a recurring routine, a rule. Ephemeral logistics (one-off times, single tasks, today's weather, greetings) are NOT memories.
Also decide WHO it is about: "household" when it is about the home, the family as a whole, or something everyone should know (the thermostat brand, the school, a family routine); "person" when it is about one individual (their health, medication, finances, work, feelings, habits, a private plan). Mark "sensitive": true for health, medical, financial, legal, mental-health or relationship details.
Respond with ONLY a JSON object: {"remember": boolean, "type": "fact"|"preference"|"routine"|"rule"|"insight", "text": "one plain sentence, third person, self-contained", "about": "household"|"person", "sensitive": boolean}`;

/** Extract the first JSON object from provider text, tolerating fences and prose. */
function looseJSON(text) {
  if (!text) return null;
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Judge one exchange and store a memory if it deserves one. Never throws.
 * `visibility`/`nestId` come from the conversation the exchange happened in;
 * no conversation (a one-off ask) defaults to personal — the privacy-safe direction.
 */
export async function captureMemoryFromExchange({ householdId, actorId, visibility, nestId, message, answer, via = "chat", agentId = null, agentName = null } = {}) {
  try {
    const msg = String(message ?? "").trim();
    const ans = String(answer ?? "").trim();
    // Too short to contain a durable fact; skipping saves a provider call per trivial turn.
    if (msg.length < 12 || ans.length < 1) return null;
    if (aiBudgetExhausted?.(householdId)) return null;
    const providerId = activeProviderId(undefined, householdId);
    if (!providerId) return null;

    recordAiUsage(householdId, "memory");
    const out = await providerChat(providerId, {
      messages: [
        { role: "system", content: CAPTURE_SYS },
        { role: "user", content: `${via === "helper" ? `Helper "${agentName ?? "helper"}" was asked` : `Member ${getMember(actorId)?.displayName ?? actorId} said`}: ${msg.slice(0, 1200)}\n\nAssistant replied: ${ans.slice(0, 1600)}` },
      ],
    }).catch(() => null);
    if (!out?.ok) return null;
    const parsed = looseJSON(out.text);
    const text = String(parsed?.text ?? "").trim();
    if (!parsed?.remember || text.length < 8 || text.length > 500) return null;

    // Same dedupe rule as the run judge: an identical memory is noise, not reinforcement.
    const existing = listMemory({ householdId, limit: 500 });
    if (existing.some((m) => String(m.text).trim().toLowerCase() === text.toLowerCase())) return null;

    const roomScope = visibility === "nest" && nestId ? "nest" : visibility === "household" ? "household" : "personal";
    // A personal or sensitive fact never widens beyond its person, whatever room it was said in.
    const personal = parsed.about === "person" || parsed.sensitive === true;
    const scope = personal ? "personal" : roomScope;
    const type = ["fact", "preference", "routine", "rule", "insight"].includes(parsed.type) ? parsed.type : "insight";
    const rec = addMemory({
      householdId, scope, type, text,
      ...(scope === "nest" ? { nestId } : {}),
      sensitive: parsed.sensitive === true,
      source: { actorId, via, ...(agentId ? { agentId, agentName } : {}) },
    });
    appendAudit({ type: "memory.captured", householdId, memoryId: rec.id, scope, memoryType: type, narrowed: personal && roomScope !== "personal", via });
    // Tell the person when something was kept as THEIRS out of a shared room (or by a helper):
    // it is the one case where a memory could surprise them, and Memory is where to remove it.
    if (personal && (roomScope !== "personal" || via === "helper")) {
      try {
        addNotification({
          householdId, actorId, channel: "in_app",
          title: "Famili remembered something about you",
          body: `Kept for you only (not the household): “${text}”. Remove it in Library → Memory if it shouldn't be.`,
          source: agentId ? { kind: "helper", id: agentId, name: agentName ?? getAgent(agentId)?.name ?? null } : { kind: "assistant" },
          data: { type: "memory", id: rec.id },
        });
      } catch { /* the memory is kept either way */ }
    }
    return rec;
  } catch { return null; /* a memory is a bonus; the chat already succeeded */ }
}
