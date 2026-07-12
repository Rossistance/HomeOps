import { useMemo } from "react";
import { useStore } from "@/store/useStore";
import { Card, Button } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { fmtDateFull, fmtTime } from "@/lib/dates";
import { HelpInbox, ScheduleList, useMyHelpRequests } from "./GrandparentView";

/** The sitter/helper dashboard: the same calm schedule + help inbox a grandparent
 *  gets, PLUS the tasks assigned to me with one-tap complete buttons. */
export function SitterView() {
  const data = useStore((s) => s.data);
  const me = useStore((s) => s.currentMember());
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const { requests, reload } = useMyHelpRequests();

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = (me?.displayName ?? "there").split(" ")[0];

  const startOfToday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const myTasks = useMemo(() => data.tasks
    .filter((t) => t.assignedMemberId === me?.id)
    .filter((t) => t.status !== "done" || +new Date(t.updatedAt) >= startOfToday)
    .sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0)), [data.tasks, me?.id, startOfToday]);
  const openCount = myTasks.filter((t) => t.status !== "done").length;
  const pendingForMe = requests.filter((r) => r.status === "pending" && r.toActorId === me?.id).length;

  return (
    <div className="space-y-5">
      <div className="hearth card-pad animate-scale-in sm:p-7">
        <span className="hearth-glow" aria-hidden="true" />
        <div className="relative z-10">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-white/45">{fmtDateFull(new Date())}</p>
          <h1 className="font-display mt-1.5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">Good {partOfDay}, {firstName}</h1>
          <p className="mt-3 text-lg leading-relaxed text-white/70">
            {[
              openCount > 0 ? `${openCount} task${openCount === 1 ? "" : "s"} assigned to you` : null,
              pendingForMe > 0 ? `${pendingForMe} help request${pendingForMe === 1 ? "" : "s"} waiting` : null,
            ].filter(Boolean).join(" · ") || "Here's the family's schedule at a glance."}
          </p>
        </div>
      </div>

      <HelpInbox meId={me?.id ?? ""} requests={requests} onChanged={reload} />

      {/* Assigned to you — with complete buttons */}
      <Card className="card-pad">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="ClipboardCheck" size={15} /> Assigned to you</h3>
        {myTasks.length === 0 ? (
          <p className="text-base text-ink-500">No tasks assigned to you right now.</p>
        ) : (
          <ul className="space-y-2">
            {myTasks.map((t) => {
              const done = t.status === "done";
              return (
                <li key={t.id} className={`flex items-center gap-3 rounded-2xl border px-4 py-2.5 ${done ? "border-sage-100 bg-sage-50" : "border-ink-900/[0.06] bg-surface-rim"}`}>
                  <Icon name={done ? "CheckCircle2" : "Circle"} size={20} className={done ? "shrink-0 text-sage-500" : "shrink-0 text-ink-300"} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-base font-medium ${done ? "text-ink-400 line-through" : "text-ink-800"}`}>{t.title}</p>
                    {t.dueAt && !done && <p className="text-sm text-ink-500">Due {fmtTime(t.dueAt)}</p>}
                  </div>
                  {!done && <Button size="sm" variant="success" onClick={() => setTaskStatus(t.id, "done")}><Icon name="Check" size={14} /> Done</Button>}
                  {done && <Button size="sm" variant="ghost" onClick={() => setTaskStatus(t.id, "todo")}>Undo</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="card-pad">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name="CalendarDays" size={15} /> The family schedule</h3>
        <ScheduleList events={data.events} />
      </Card>
    </div>
  );
}
