// Turning what a file SAYS into things the family can actually add.
//
// "It'd be really amazing if I could ask questions about them, and then even more amazing than
// all that would be to have it be able to parse information from them into categories or
// presented back to me, and recognise things that it correlates with the app — like if it was
// a photo of a schedule it could say 'I found these items, here are the cards, choose which
// ones you'd want to add'."
//
// The design decision that matters here is the last clause. This module PROPOSES and never
// writes. A photo of a school schedule holds nine things; creating nine calendar events
// because someone attached a picture is the kind of help nobody asked for, and it would be
// indistinguishable from the app inventing appointments. Everything comes back as candidates,
// rendered as cards, and a person taps Add.
import { getSettings, recordAiUsage, aiBudgetExhausted } from "./store.mjs";
import { providerChatWithFallback } from "./ai.mjs";

const EXTRACT_SYS = `You pull structured items out of a document or photo a family uploaded to their household assistant.

Find only things a family would actually put in a calendar or a to-do list:
- "event"     something happening at a time or on a date (practice, appointment, party, deadline, trip)
- "task"      something someone has to DO (bring a form, pay a fee, sign up, buy something)
- "list_item" something to acquire (groceries, supplies)

Rules:
- ONLY what the source states. Never infer an item that is not written there.
- Copy dates and times EXACTLY as given. If a year is absent, leave it absent — do not guess one.
- If something has no date and no action, it is not an item. Leave it out.
- "title" is short and human, the way a person would name it on a calendar.
- Keep the source's own wording in "detail" when it adds anything (room number, what to bring, cost).

Respond with ONLY JSON, no prose and no fences:
{"items":[{"type":"event"|"task"|"list_item","title":string,"when":string|null,"where":string|null,"detail":string|null,"who":string|null}]}
Return {"items":[]} if there is genuinely nothing.`;

const TYPE_LABEL = { event: "Event", task: "Task", list_item: "List item" };

/**
 * Extract candidate items from already-read text.
 *
 * Returns `{ ok, items }` where each item is shaped for the existing card renderer
 * (assistant-runs.mjs rowCard reads title/when/where/detail/meta), so extraction results
 * display through exactly the same path as every other set of rows in the chat.
 */
export async function extractStructured({ householdId, text, sourceName }) {
  const body = String(text ?? "").trim();
  if (!body) return { ok: true, items: [] };

  const providerId = getSettings(householdId).aiActiveProvider;
  if (!providerId) {
    return { ok: false, error: "no_provider", message: "No AI provider is connected, so I can't pull items out of a file yet. Add one in Settings → AI Providers." };
  }
  if (aiBudgetExhausted(householdId)) {
    return { ok: false, error: "budget_exhausted", message: "The household's daily AI budget is used up, so I'll leave this file for now." };
  }
  recordAiUsage(householdId, "extract");

  const out = await providerChatWithFallback(providerId, {
    messages: [
      { role: "system", content: EXTRACT_SYS },
      { role: "user", content: `Source: ${sourceName ?? "an uploaded file"}\n\n${body.slice(0, 12_000)}` },
    ],
  }).catch((e) => ({ ok: false, error: "provider_error", message: String(e?.message ?? e) }));

  if (!out.ok) return { ok: false, error: out.error ?? "extract_failed", message: out.message ?? "Couldn't read that file's contents just now." };

  let parsed = null;
  try {
    const t = String(out.text ?? "");
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) parsed = JSON.parse(t.slice(a, b + 1));
  } catch { /* handled below */ }
  if (!parsed || !Array.isArray(parsed.items)) {
    // A model that ignored the format is not a reason to invent items.
    return { ok: true, items: [] };
  }

  const items = [];
  for (const raw of parsed.items.slice(0, 25)) {
    const title = String(raw?.title ?? "").trim();
    if (!title) continue;
    const type = ["event", "task", "list_item"].includes(raw?.type) ? raw.type : "task";
    const meta = [{ label: "Kind", value: TYPE_LABEL[type] }];
    if (raw?.who) meta.push({ label: "For", value: String(raw.who).slice(0, 40) });
    items.push({
      // rowCard picks these up by name — title/when/where/detail/meta.
      title: title.slice(0, 160),
      // `when` stays the source's OWN string. Parsing "Tues 4:15" into an ISO stamp here would
      // be guessing at a year and a timezone, and a wrong date presented as a confident card is
      // worse than the words the family already recognise from their own document.
      when: raw?.when ? String(raw.when).slice(0, 80) : null,
      where: raw?.where ? String(raw.where).slice(0, 120) : null,
      detail: raw?.detail ? String(raw.detail).slice(0, 400) : null,
      meta,
      // What an Add button would create. Carried so the client doesn't have to re-derive it.
      candidate: {
        type,
        title: title.slice(0, 160),
        when: raw?.when ? String(raw.when).slice(0, 80) : null,
        where: raw?.where ? String(raw.where).slice(0, 120) : null,
        notes: raw?.detail ? String(raw.detail).slice(0, 400) : null,
        who: raw?.who ? String(raw.who).slice(0, 60) : null,
        source: sourceName ?? null,
      },
    });
  }
  return { ok: true, items };
}
