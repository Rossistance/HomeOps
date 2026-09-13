import { useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { Card } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { fmtDateFull, fmtTime, isTodayEvent } from "@/lib/dates";
import { HelpComposer } from "@/components/HelpComposer";
import { isChild } from "@/lib/roles";
import { useMyHelpRequests } from "./GrandparentView";

/** The child dashboard: a big friendly greeting, today's chores (mine, toggleable),
 *  a read-only look at today's schedule, a kid-friendly ask/offer help affordance
 *  (to and from other children), and who's helping with today's events. */
export function KidView() {
  const data = useStore((s) => s.data);
  const me = useStore((s) => s.currentMember());
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const { requests, reload } = useMyHelpRequests();
  const [helpOpen, setHelpOpen] = useState(false);

  // Kids ask/offer help to/from other kids — the person picker is scoped to siblings.
  const otherKids = useMemo(() => data.members.filter((m) => m.id !== me?.id && isChild(m)), [data.members, me?.id]);

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = (me?.displayName ?? "there").split(" ")[0];

  // My chores: everything assigned to me that isn't finished, plus what I finished
  // today (so checking a box feels rewarding instead of making the item vanish).
  const startOfToday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const myChores = useMemo(() => data.tasks
    .filter((t) => t.assignedMemberId === me?.id)
    .filter((t) => t.status !== "done" || +new Date(t.updatedAt) >= startOfToday)
    .sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0)), [data.tasks, me?.id, startOfToday]);
  const doneCount = myChores.filter((t) => t.status === "done").length;

  // Today's schedule (read-only) — my events first, else the whole family's day.
  const endOfToday = useMemo(() => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }, []);
  const todays = useMemo(() => [...data.events]
    .filter((e) => isTodayEvent(e))
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)), [data.events, startOfToday, endOfToday]);
  const mine = todays.filter((e) => me && e.memberIds.includes(me.id));
  const schedule = mine.length > 0 ? mine : todays;

  // Who's helping you: accepted help requests linked to one of today's events.
  const todayIds = useMemo(() => new Set(todays.map((e) => e.serverId ?? e.id)), [todays]);
  const helpers = requests.filter((r) => r.status === "accepted" && r.eventId && todayIds.has(r.eventId));
  const eventTitle = (id: string | null) => todays.find((e) => (e.serverId ?? e.id) === id)?.title ?? "today";

  return (
    <div className="space-y-5">
      {/* Big friendly greeting */}
      <div className="hearth card-pad animate-scale-in sm:p-7">
        <span className="hearth-glow" aria-hidden="true" />
        <div className="relative z-10">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">{fmtDateFull(new Date())}</p>
          <h1 className="font-display mt-1.5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">Good {partOfDay}, {firstName}! 👋</h1>
          <p className="mt-3 text-lg text-white/70">
            {myChores.length === 0
              ? "No chores today — enjoy your day!"
              : doneCount === myChores.length
                ? "All your chores are done. Amazing! 🎉"
                : `You have ${myChores.length - doneCount} chore${myChores.length - doneCount === 1 ? "" : "s"} on your list.`}
          </p>
        </div>
      </div>

      {/* Today's chores */}
      <Card className="card-pad">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="ListChecks" size={15} /> Today's chores</h3>
        {myChores.length === 0 ? (
          <p className="text-base text-ink-500">Nothing on your list. 🌟</p>
        ) : (
          <ul className="space-y-2">
            {myChores.map((t) => {
              const done = t.status === "done";
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setTaskStatus(t.id, done ? "todo" : "done")}
                    aria-pressed={done}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${done ? "border-sage-100 bg-sage-50" : "border-ink-900/[0.06] bg-surface-rim hover:border-ember-200"}`}
                  >
                    <Icon name={done ? "CheckCircle2" : "Circle"} size={22} className={done ? "shrink-0 text-sage-500" : "shrink-0 text-ink-300"} />
                    <span className={`flex-1 text-base font-medium ${done ? "text-ink-400 line-through" : "text-ink-800"}`}>{t.title}</span>
                    {done && <span className="text-lg" aria-hidden="true">🎉</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Today's schedule (read-only) */}
      <Card className="card-pad">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="CalendarDays" size={15} /> Your day</h3>
        {schedule.length === 0 ? (
          <p className="text-base text-ink-500">Nothing scheduled today — free time!</p>
        ) : (
          <ol className="space-y-2">
            {schedule.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-2xl border border-ink-900/[0.05] bg-surface-rim px-4 py-2.5">
                <span className="w-16 shrink-0 text-sm font-semibold text-ink-700">{fmtTime(e.startAt)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-ink-900">{e.title}</p>
                  {e.location && <p className="truncate text-sm text-ink-500">{e.location}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* Ask or offer help — kid to kid */}
      {me && otherKids.length > 0 && (
        <Card className="card-pad">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="HeartHandshake" size={15} /> Ask or offer help</h3>
            <button onClick={() => setHelpOpen((v) => !v)} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">{helpOpen ? "Close" : "Open"}</button>
          </div>
          {helpOpen
            ? <HelpComposer me={me} people={otherKids} events={data.events} tasks={data.tasks} kidFriendly onSent={reload} />
            : <p className="text-base text-ink-500">Need a hand — or want to help a brother or sister? Tap Open.</p>}
        </Card>
      )}

      {/* Who's helping you today */}
      <Card className="card-pad">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="HeartHandshake" size={15} /> Who's helping you</h3>
        {helpers.length === 0 ? (
          <p className="text-base text-ink-500">No helpers lined up for today.</p>
        ) : (
          <ul className="space-y-2">
            {helpers.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-sage-100 bg-sage-50/70 px-4 py-2.5 text-base text-ink-800">
                <Icon name="UserCheck" size={18} className="shrink-0 text-sage-600" />
                <span><span className="font-semibold">{r.toName}</span> is helping with <span className="font-semibold">{eventTitle(r.eventId)}</span>{r.responseNote ? ` — “${r.responseNote}”` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
