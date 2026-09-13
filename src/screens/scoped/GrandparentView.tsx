import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { Card, Button, Badge, TextInput, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { fmtDateFull, fmtTime, dayName, isLive, isTodayEvent, eventTimeLabel } from "@/lib/dates";
import { backend, type HelpRequest } from "@/connectors/api";
import type { CalendarEvent } from "@/types";

/* ------------------------- shared scoped-view pieces ------------------------- *
 * Also used by SitterView (sitter = this calm view + assigned tasks).           */

export function useMyHelpRequests() {
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => { setRequests(await backend.helpRequests()); setLoaded(true); }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { requests, loaded, reload };
}

/** Calm, large-type read-only schedule: today first, then the rest of this week. */
export function ScheduleList({ events }: { events: CalendarEvent[] }) {
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(); endOfToday.setHours(24, 0, 0, 0);
  const endOfWeek = startOfToday.getTime() + 7 * 864e5;
  const upcoming = useMemo(() => [...events]
    .filter((e) => { const t = +new Date(e.startAt); return !isNaN(t) && isLive(e, now) && t < endOfWeek; })
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)), [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = upcoming.filter((e) => isTodayEvent(e, now));
  const week = upcoming.filter((e) => !isTodayEvent(e, now));
  void startOfToday; void endOfToday;

  const Row = ({ e, showDay }: { e: CalendarEvent; showDay?: boolean }) => (
    <li className="flex items-center gap-4 rounded-2xl border border-ink-900/[0.05] bg-surface-rim px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
      <div className="flex w-16 shrink-0 flex-col items-center leading-tight">
        {showDay && <span className="text-xs font-semibold uppercase text-ink-400">{dayName(e.startAt).slice(0, 3)}</span>}
        <span className="text-base font-semibold text-ink-800">{eventTimeLabel(e)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-medium text-ink-900">{e.title}</p>
        {e.location && <p className="truncate text-sm text-ink-500">{e.location}</p>}
      </div>
    </li>
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-400">Today</p>
        {today.length === 0
          ? <div className="well flex items-center gap-2 p-4 text-base text-ink-500"><Icon name="CalendarCheck" size={18} className="text-sage-500" /> A calm day — nothing scheduled.</div>
          : <ol className="space-y-2.5">{today.map((e) => <Row key={e.id} e={e} />)}</ol>}
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-400">This week</p>
        {week.length === 0
          ? <div className="well flex items-center gap-2 p-4 text-base text-ink-500"><Icon name="CalendarRange" size={18} className="text-ink-400" /> Nothing else this week.</div>
          : <ol className="space-y-2.5">{week.slice(0, 10).map((e) => <Row key={e.id} e={e} showDay />)}</ol>}
      </div>
    </div>
  );
}

/** "Can you help?" — pending help requests addressed to ME, with Accept / Decline
 *  (plus an optional note) through the server help-request endpoints. */
export function HelpInbox({ meId, requests, onChanged }: { meId: string; requests: HelpRequest[]; onChanged: () => void | Promise<void> }) {
  const toast = useStore((s) => s.toast);
  const events = useStore((s) => s.data.events);
  const tasks = useStore((s) => s.data.tasks);
  const pending = requests.filter((r) => r.status === "pending" && r.toActorId === meId);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // The task a request is about (events get a richer detail line below, resolved inline).
  const taskLabelFor = (r: HelpRequest) => (r.taskId ? tasks.find((t) => (t.serverId ?? t.id) === r.taskId)?.title ?? null : null);

  const respond = async (r: HelpRequest, response: "accept" | "decline") => {
    setBusyId(r.id);
    const res = await backend.respondHelpRequest(r.id, response, notes[r.id]?.trim() || undefined);
    setBusyId(null);
    if (res.error) { toast({ kind: "error", title: "Couldn't send your answer", message: res.message ?? res.error }); return; }
    toast({ kind: "success", title: response === "accept" ? (r.kind === "offer" ? "Thanks — help is on the way!" : "You're helping — thank you!") : "Answer sent" });
    await onChanged();
  };

  return (
    <Card className="card-pad">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="HeartHandshake" size={15} /> Can you help?</h3>
      {pending.length === 0 ? (
        <p className="text-base text-ink-500">No one needs a hand right now.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => {
            const ev = r.eventId ? events.find((e) => (e.serverId ?? e.id) === r.eventId) : null;
            const taskLabel = taskLabelFor(r);
            const isOffer = r.kind === "offer";
            return (
              <li key={r.id} className="rounded-2xl border border-amber-200/70 bg-amber-50/60 p-4">
                <p className="text-base text-ink-800">
                  <span className="font-semibold">{r.fromName}</span>{" "}
                  {isOffer
                    ? <>offered to help{taskLabel ? <> with <span className="font-semibold">{taskLabel}</span></> : ev ? <> with <span className="font-semibold">{ev.title}</span></> : null}</>
                    : <>asks: “{r.message}”</>}
                </p>
                {isOffer && r.message && <p className="mt-1 text-sm text-ink-600">“{r.message}”</p>}
                {ev && <p className="mt-1 text-sm text-ink-500"><Icon name="Calendar" size={13} className="mr-1 inline" /> {ev.title} · {dayName(ev.startAt)} {fmtTime(ev.startAt)}{ev.location ? ` · ${ev.location}` : ""}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="success" disabled={busyId === r.id} onClick={() => void respond(r, "accept")}><Icon name="Check" size={15} /> {isOffer ? "Yes, please" : "Yes, I can"}</Button>
                  <Button variant="secondary" disabled={busyId === r.id} onClick={() => void respond(r, "decline")}><Icon name="X" size={15} /> {isOffer ? "No thanks" : "Sorry, not this time"}</Button>
                  <TextInput value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} placeholder="Add a note (optional)" className="min-w-[12rem] flex-1" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------ Grandparent view ----------------------------- */

export function GrandparentView() {
  const data = useStore((s) => s.data);
  const me = useStore((s) => s.currentMember());
  const { requests, reload } = useMyHelpRequests();
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = (me?.displayName ?? "there").split(" ")[0];
  const pendingForMe = requests.filter((r) => r.status === "pending" && r.toActorId === me?.id).length;

  return (
    <div className="space-y-5">
      <div className="hearth card-pad animate-scale-in sm:p-7">
        <span className="hearth-glow" aria-hidden="true" />
        <div className="relative z-10">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-white/45">{fmtDateFull(new Date())}</p>
          <h1 className="font-display mt-1.5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">Good {partOfDay}, {firstName}</h1>
          <p className="mt-3 text-lg leading-relaxed text-white/70">
            {pendingForMe > 0 ? `The family is asking for your help with ${pendingForMe} thing${pendingForMe === 1 ? "" : "s"}.` : "Here's the family's week at a glance."}
          </p>
        </div>
      </div>

      <HelpInbox meId={me?.id ?? ""} requests={requests} onChanged={reload} />

      <Card className="card-pad">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="CalendarDays" size={15} /> The family schedule</h3>
        <ScheduleList events={data.events} />
      </Card>

      {requests.some((r) => r.toActorId === me?.id && r.status === "accepted") && (
        <Card className="card-pad">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="CheckCircle2" size={15} /> You said yes to</h3>
          <ul className="space-y-1.5">
            {requests.filter((r) => r.toActorId === me?.id && r.status === "accepted").slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-base text-ink-700"><Badge color="sage"><Icon name="Check" size={11} /> helping</Badge> {r.message}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Shared empty-state used by scoped views when nothing at all is loaded. */
export function ScopedEmpty() {
  return <EmptyState icon="CalendarCheck" title="Nothing here yet" message="When the family adds events, they'll show up here." />;
}
