import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { Button, Field, Select, TextArea, ACCENT_SOLID } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { backend, type CalendarSubscription } from "@/connectors/api";
import { fmtTime, dayName } from "@/lib/dates";
import type { Member, CalendarEvent, Task } from "@/types";

/** Shared ask ↔ offer help composer, used by the adult Dashboard HelpCard and the
 *  kid-friendly KidView.
 *
 *  - "Ask" (from-actor asks the recipient to help with the from-actor's item): pick a
 *    person, optionally link one of MY upcoming events, write a message, send kind:"ask".
 *  - "Offer" (from-actor offers to help with the recipient's item): pick a person, then
 *    pick one of THAT person's upcoming events or open tasks, message prefilled
 *    ("I can help with {item}"), send kind:"offer".
 *
 *  Person picker contents are supplied by the caller (`people`) so a kid view can scope
 *  it to other children while the adult view offers the whole household. */
export function HelpComposer({
  me, people, events, tasks, onSent, kidFriendly = false,
}: {
  me: Member;
  people: Member[];
  events: CalendarEvent[];
  tasks: Task[];
  onSent?: () => void | Promise<void>;
  kidFriendly?: boolean;
}) {
  const toast = useStore((s) => s.toast);
  const [kind, setKind] = useState<"ask" | "offer">("ask");
  const [toId, setToId] = useState("");
  const [sel, setSel] = useState(""); // "event:<id>" | "task:<id>" | ""
  const [message, setMessage] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);

  // Free/busy hint only matters for adult asks against a linked calendar.
  useEffect(() => { if (!kidFriendly) void backend.calendarSubscriptions().then(setSubs); }, [kidFriendly]);

  const now = Date.now();
  const eventId = (e: CalendarEvent) => e.serverId ?? e.id;
  const taskId = (t: Task) => t.serverId ?? t.id;

  // Events owned-by / involving a member, in the next two weeks.
  const upcomingFor = (ownerId: string) => events
    .filter((e) => { const t = +new Date(e.startAt); return !isNaN(t) && t >= now - 36e5 && t <= now + 14 * 864e5; })
    .filter((e) => e.ownerId === ownerId || (e.memberIds ?? []).includes(ownerId))
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).slice(0, 30);
  const openTasksFor = (ownerId: string) => tasks
    .filter((t) => t.assignedMemberId === ownerId && t.status !== "done").slice(0, 30);

  // Ask links one of MY events; Offer links the TARGET's events or open tasks.
  const itemEvents = useMemo(() => {
    if (kind === "ask") return upcomingFor(me.id);
    return toId ? upcomingFor(toId) : [];
  }, [kind, toId, events, me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const itemTasks = useMemo(() => (kind === "offer" && toId ? openTasksFor(toId) : []), [kind, toId, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const labelForValue = (value: string): string => {
    const [type, id] = value.split(":");
    if (type === "event") return events.find((e) => eventId(e) === id)?.title ?? "an event";
    if (type === "task") return tasks.find((t) => taskId(t) === id)?.title ?? "a task";
    return "";
  };

  const prefillFor = (value: string): string => {
    if (!value) return "";
    const label = labelForValue(value);
    if (kind === "offer") return `I can help with ${label}.`;
    return kidFriendly ? `Can you help me with ${label}?` : `Can you pick up the girls from ${label}?`;
  };

  const pickItem = (value: string) => {
    setSel(value);
    if (!messageEdited || !message.trim()) { setMessage(prefillFor(value)); setMessageEdited(false); }
  };
  const switchKind = (k: "ask" | "offer") => {
    if (k === kind) return;
    setKind(k); setSel("");
    if (!messageEdited) { setMessage(""); setMessageEdited(false); }
  };
  const pickPerson = (id: string) => {
    setToId(id);
    // The target's items change, so drop any stale selection.
    setSel("");
    if (kind === "offer" && !messageEdited) { setMessage(""); setMessageEdited(false); }
  };

  // Free/busy hint: only for an adult ask that links an event, when the chosen person
  // has a connected calendar — then look for an overlap in THEIR events.
  const hint = useMemo(() => {
    if (kidFriendly || kind !== "ask" || !toId) return null;
    const [type, id] = sel.split(":");
    if (type !== "event") return null;
    const chosen = events.find((e) => eventId(e) === id);
    if (!chosen) return null;
    if (!subs.some((s) => s.ownerActorId === toId)) return null;
    const start = +new Date(chosen.startAt);
    if (isNaN(start)) return null;
    const end = chosen.endAt ? +new Date(chosen.endAt) : start + 36e5;
    const clash = events.find((e) => {
      if (eventId(e) === id) return false;
      if (!(e.ownerId === toId || (e.memberIds ?? []).includes(toId))) return false;
      const s0 = +new Date(e.startAt);
      if (isNaN(s0)) return false;
      const e0 = e.endAt ? +new Date(e.endAt) : s0 + 36e5;
      return s0 < end && e0 > start;
    });
    return clash ? { busy: true as const, title: clash.title } : { busy: false as const, title: "" };
  }, [kidFriendly, kind, toId, sel, subs, events]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!toId || !message.trim() || busy) return;
    setBusy(true);
    const [type, id] = sel.split(":");
    const r = await backend.createHelpRequest({
      toActorId: toId,
      message: message.trim(),
      kind,
      eventId: type === "event" ? id : undefined,
      taskId: type === "task" ? id : undefined,
    });
    setBusy(false);
    if (r.error) { toast({ kind: "error", title: "Couldn't send that", message: r.message ?? r.error }); return; }
    const name = people.find((m) => m.id === toId)?.displayName.split(" ")[0] ?? "They";
    toast({
      kind: "success",
      title: kind === "offer" ? "Offer sent" : "Help request sent",
      message: kind === "offer" ? `${name} will see that you offered to help.` : `${name} will see it on their dashboard.`,
    });
    setToId(""); setSel(""); setMessage(""); setMessageEdited(false); setKind("ask");
    await onSent?.();
  };

  const eventOptionLabel = (e: CalendarEvent) => `${dayName(e.startAt).slice(0, 3)} ${fmtTime(e.startAt)} — ${e.title}`;
  const taskOptionLabel = (t: Task) => `${t.title}${t.dueAt ? ` (due ${fmtTime(t.dueAt)})` : ""}`;
  const hasItems = itemEvents.length > 0 || itemTasks.length > 0;

  const copy = kidFriendly
    ? { who: "Who?", noPeople: "No brothers or sisters to ask yet.", send: kind === "offer" ? "Offer to help" : "Ask for help" }
    : { who: "Who", noPeople: "No other members yet — add family in Household Spaces.", send: "Send" };

  return (
    <div className="space-y-3">
      {/* Ask ↔ Offer toggle */}
      <div className="inline-flex rounded-full border border-ink-900/[0.08] bg-surface-sunken/60 p-0.5" role="tablist" aria-label="Ask or offer help">
        {(["ask", "offer"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => switchKind(k)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${kind === k ? "bg-ember-400 text-ink-900 shadow-ember" : "text-ink-500 hover:text-ink-800"}`}>
            {k === "ask" ? "Ask for help" : "Offer to help"}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{copy.who}</p>
        <div className="flex flex-wrap gap-1.5">
          {people.map((m) => {
            const on = toId === m.id;
            return (
              <button key={m.id} onClick={() => pickPerson(on ? "" : m.id)} aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${on ? "border-ember-400 bg-ember-50 text-ember-700" : "border-ink-900/[0.08] bg-surface-sunken/60 text-ink-600 hover:text-ink-800"}`}>
                <span className={`h-2 w-2 rounded-full ${ACCENT_SOLID[m.avatarColor] ?? ACCENT_SOLID.gray}`} />
                {m.displayName.split(" ")[0]}
              </button>
            );
          })}
          {people.length === 0 && <p className="text-xs text-ink-400">{copy.noPeople}</p>}
        </div>
      </div>

      {/* Item picker. Ask: my events (optional). Offer: the target's events + open tasks. */}
      {kind === "offer" ? (
        <Field label="What can you help with?">
          {!toId ? (
            <p className="text-xs text-ink-400">Pick someone first to see what they have going on.</p>
          ) : !hasItems ? (
            <p className="text-xs text-ink-400">Nothing on their plate right now — you can still send a note below.</p>
          ) : (
            <Select value={sel} onChange={(e) => pickItem(e.target.value)}>
              <option value="">Choose an event or task…</option>
              {itemEvents.length > 0 && (
                <optgroup label="Their events">
                  {itemEvents.map((e) => <option key={`event:${eventId(e)}`} value={`event:${eventId(e)}`}>{eventOptionLabel(e)}</option>)}
                </optgroup>
              )}
              {itemTasks.length > 0 && (
                <optgroup label="Their tasks">
                  {itemTasks.map((t) => <option key={`task:${taskId(t)}`} value={`task:${taskId(t)}`}>{taskOptionLabel(t)}</option>)}
                </optgroup>
              )}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="For an event (optional)">
          <Select value={sel} onChange={(e) => pickItem(e.target.value)}>
            <option value="">No specific event</option>
            {itemEvents.map((e) => <option key={`event:${eventId(e)}`} value={`event:${eventId(e)}`}>{eventOptionLabel(e)}</option>)}
          </Select>
        </Field>
      )}

      <Field label="Message">
        <TextArea rows={2} value={message}
          placeholder={kind === "offer" ? "I can lend a hand with…" : "Can you pick up the girls from practice?"}
          onChange={(e) => { setMessage(e.target.value); setMessageEdited(true); }} />
      </Field>

      <div className="flex items-center gap-3">
        <Button variant="ember" disabled={!toId || !message.trim() || busy} onClick={() => void send()}>
          <Icon name={kind === "offer" ? "HeartHandshake" : "Send"} size={14} /> {copy.send}
        </Button>
        {hint && (hint.busy
          ? <span className="text-xs font-medium text-amber-600">⚠ busy with {hint.title}</span>
          : <span className="text-xs font-medium text-sage-600">✓ free</span>)}
      </div>
    </div>
  );
}
