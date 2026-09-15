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
import { providerChat } from "./ai.mjs";
import { activeProviderId } from "./context.mjs";
import { addMemory, listMemory, appendAudit, recordAiUsage, aiBudgetExhausted } from "./store.mjs";

const CAPTURE_SYS = `You watch one exchange between a family member and their household assistant. Decide if it revealed something DURABLE about the household worth remembering for future conversations: a stable preference, a fact about a person or the home, a recurring routine, a rule. Ephemeral logistics (one-off times, single tasks, weather, greetings) are NOT memories. Respond with ONLY a JSON object: {"remember": boolean, "type": "fact"|"preference"|"routine"|"rule"|"insight", "text": "one plain sentence, third person, self-contained"}`;

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
export async function captureMemoryFromExchange({ householdId, actorId, visibility, nestId, message, answer } = {}) {
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
        { role: "user", content: `Member said: ${msg.slice(0, 1200)}\n\nAssistant replied: ${ans.slice(0, 1200)}` },
      ],
    }).catch(() => null);
    if (!out?.ok) return null;
    const parsed = looseJSON(out.text);
    const text = String(parsed?.text ?? "").trim();
    if (!parsed?.remember || text.length < 8 || text.length > 500) return null;

    // Same dedupe rule as the run judge: an identical memory is noise, not reinforcement.
    const existing = listMemory({ householdId, limit: 500 });
    if (existing.some((m) => String(m.text).trim().toLowerCase() === text.toLowerCase())) return null;

    const scope = visibility === "nest" && nestId ? "nest" : visibility === "household" ? "household" : "personal";
    const type = ["fact", "preference", "routine", "rule", "insight"].includes(parsed.type) ? parsed.type : "insight";
    const rec = addMemory({
      householdId, scope, type, text,
      ...(scope === "nest" ? { nestId } : {}),
      source: { actorId, via: "chat" },
    });
    appendAudit({ type: "memory.captured", householdId, memoryId: rec.id, scope, memoryType: type });
    return rec;
  } catch { return null; /* a memory is a bonus; the chat already succeeded */ }
}
