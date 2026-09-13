import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { Card, Button, Badge, StatusDot, EmptyState, Modal, Field, TextInput, ReadinessBadge, ACCENT_BG, MemberDots } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { generateBriefing, suggestNextActions } from "@/lib/ai";
import { fmtDateFull, dayName, relativeTime, isOverdue, isLive, isTodayEvent, eventTimeLabel } from "@/lib/dates";
import { backend, type ServerEvolution, type HelpRequest } from "@/connectors/api";
import type { Member, CalendarEvent, Task } from "@/types";
import { capabilitiesFor } from "@/lib/roles";
import { useAdvancedMode } from "@/lib/prefs";
import { MemberAvatar } from "@/components/MemberAvatar";
import { ProfileEditor } from "@/components/ProfileEditor";
import { HelpComposer } from "@/components/HelpComposer";
import { KidView } from "@/screens/scoped/KidView";
import { GrandparentView } from "@/screens/scoped/GrandparentView";
import { SitterView } from "@/screens/scoped/SitterView";
import { BOARD_TASK_TYPES } from "@/miniapps";
import { surfaceForTask } from "@/lib/taskSurfaces";

// "What I learned" feed accents — includes the signature ember for improvement ideas,
// which isn't in the shared ACCENT_BG map (that one has no ember entry).
const FEED_ACCENT: Record<string, string> = {
  sage: "bg-sage-100 text-sage-600",
  lavender: "bg-lavender-100 text-lavender-600",
  ember: "bg-ember-50 text-ember-600",
};
import type { ScreenId } from "@/types";

// One normalized row for the "What I did & learned" ledger. `auto`/`note` carry the
// server's low-risk auto-approval label + reason for improvements applied without a human.
interface LearnedItem {
  id: string;
  kind: "did" | "learned" | "improve";
  icon: string;
  accent: keyof typeof FEED_ACCENT;
  title: string;
  at: string;
  route: { screen: string; params?: Record<string, string> };
  auto?: boolean;
  note?: string;
}

export function Dashboard() {
  const data = useStore((s) => s.data);
  const me = useStore((s) => s.currentMember());
  const serverApprovals = useStore((s) => s.serverApprovals);
  const connectors = useStore((s) => s.connectors);
  const backendOnline = useStore((s) => s.backendOnline);
  const navigate = useStore((s) => s.navigate);
  const params = useStore((s) => s.route.params);
  const createTask = useStore((s) => s.createTask);
  const startConversation = useStore((s) => s.startConversation);
  const spaceFilter = useStore((s) => s.spaceFilter);
  const setSpaceFilter = useStore((s) => s.setSpaceFilter);
  const activeSpace = data.spaces.find((s) => s.id === spaceFilter);
  // Space filter actually scopes the dashboard's space-bound lists (P2-DATA-001).
  const inSpace = <T extends { spaceId?: string }>(arr: T[]): T[] => (spaceFilter === "all" ? arr : arr.filter((x) => x.spaceId === spaceFilter));

  const [reminderOpen, setReminderOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [rTitle, setRTitle] = useState("");
  const [ask, setAsk] = useState("");
  // Role-scoped dashboards: children, grandparents, and sitters get a purpose-built view
  // instead of the adult Hearth. Capabilities also gate the admin quick actions below.
  const caps = capabilitiesFor(me ? { role: me.role, relationship: me.relationship, aiEnabled: me.aiEnabled } : null);
  const [advanced] = useAdvancedMode(); // the raw activity log lives behind Advanced Mode
  // Evolution proposals are generated server-side (on run failures) and are NOT hydrated into
  // the local store — so, like the Improvements tab, pull them here and merge with any local
  // ones, or the "What I learned" card would miss the main source of improvements.
  const [serverEvos, setServerEvos] = useState<ServerEvolution[]>([]);
  useEffect(() => { void backend.evolutions().then(setServerEvos); }, []);

  useEffect(() => { if (params?.new === "reminder") setReminderOpen(true); }, [params?.new]);

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = (me?.displayName ?? "there").split(" ")[0];

  // Everything still LIVE (not yet ended — an all-day event lasts all day, a timed one until
  // its end), sorted — the base for the Today card's two columns. The old now−1h window
  // dropped an all-day event from Home at 1 AM and a 9 AM event by 10:30.
  const upcoming = useMemo(() => inSpace([...data.events]).filter((e) => isLive(e)).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)), [data.events, spaceFilter]);
  // WP-001: server truth, not the local `data.approvals` mirror — see Shell's useBadges
  // for the same fix. Server approvals have no spaceId (approvals aren't a space concept
  // server-side), so this list intentionally isn't run through inSpace().
  const pendingApprovals = serverApprovals.filter((a) => a.status === "pending");
  // The briefing and the suggestions read the SAME approvals as the hero line and the badge
  // — they used to count the write-only local mirror, so "Nothing is waiting on you" and
  // "Review 1 approval" sat on one screen together.
  const approvalsForCopy = useMemo(() => pendingApprovals.map((a) => ({ title: a.preview || a.toolId })), [pendingApprovals]);
  const briefing = useMemo(() => generateBriefing(data, approvalsForCopy), [data, approvalsForCopy]);
  const suggestions = useMemo(() => suggestNextActions(data, approvalsForCopy), [data, approvalsForCopy]);
  const canAccess = useStore((s) => s.canAccess);
  // The briefing thread is a seed id in the sample household; a real family may not have one.
  const briefingThread = useMemo(() => data.threads.find((t) => t.id === "th-briefing" || /briefing/i.test(t.title)) ?? null, [data.threads]);
  const overdue = inSpace(data.tasks.filter((t) => t.status !== "done" && isOverdue(t.dueAt)));
  // WP-004 (ISS-008, FEAT-019/005): "Open tasks" — the household's undated open tasks
  // plus upcoming (not-yet-due) dated ones, on the SAME board-eligible types the Chore
  // Board renders (BOARD_TASK_TYPES, shared with src/miniapps/index.tsx so the two
  // never drift). Overdue tasks stay exactly where they already were, above — this list
  // deliberately excludes them so nothing is double-counted. Dated tasks (soonest due
  // first) sort ahead of undated ones.
  const openTasks = useMemo(
    () =>
      inSpace(data.tasks.filter((t) => BOARD_TASK_TYPES.has(t.type) && t.status !== "done" && !isOverdue(t.dueAt))).sort((a, b) => {
        if (a.dueAt && b.dueAt) return +new Date(a.dueAt) - +new Date(b.dueAt);
        if (a.dueAt) return -1;
        if (b.dueAt) return 1;
        return 0;
      }),
    [data.tasks, spaceFilter],
  );
  // The Chore Board is the household's general task surface (binding design decision —
  // see the BOARD_TASK_TYPES comment in src/miniapps/index.tsx), so an Open-tasks row
  // always lands there. New households get the board seeded server-side (seed.mjs);
  // EXISTING households lazily receive it on first use — clicking an Open-tasks row
  // creates the default board right then (idempotent by type), so "task visible ≤2
  // clicks from Home" holds for every family, not just fresh signups.
  const choreBoardApp = data.miniApps.find((m) => m.type === "Chore Board");
  const createMiniApp = useStore((s) => s.createMiniApp);
  const openChoreBoard = () => {
    if (choreBoardApp) return navigate("miniapps", { id: choreBoardApp.id });
    const id = createMiniApp({
      name: "Family Chore Board",
      type: "Chore Board",
      description: "Kanban of who's doing what — To Do → In Progress → Done.",
      data: { columns: [{ key: "todo", title: "To Do" }, { key: "in-progress", title: "In Progress" }, { key: "done", title: "Done" }, { key: "needs-help", title: "Needs Help" }] },
    });
    navigate("miniapps", { id });
  };
  const activeAgents = inSpace(data.agents.filter((a) => a.status === "Active" || a.status === "Needs Attention"));
  const recentFiles = useMemo(() => inSpace([...data.files]).sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt)).slice(0, 4), [data.files, spaceFilter]);
  const recentThreads = useMemo(() => inSpace([...data.threads]).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4), [data.threads, spaceFilter]);
  const liveConnectors = connectors.filter((c) => c.live);
  const attentionCount = overdue.length + pendingApprovals.length;

  // Calendar-under-Ask (WS1): split today's events into "today" vs "coming up" so the
  // key card mirrors the mobile Today screen — the nearest things first, then a peek ahead.
  const eventsToday = useMemo(() => upcoming.filter((e) => isTodayEvent(e)).slice(0, 8), [upcoming]);
  const comingUp = useMemo(() => upcoming.filter((e) => !isTodayEvent(e)).slice(0, 3), [upcoming]);
  const memberById = useMemo(() => new Map(data.members.map((m) => [m.id, m])), [data.members]);

  // "What I did & learned" (WS3): one honest, glanceable ledger of what the household's
  // helpers just did (recent completed runs), what FamiliOS remembered (new memories),
  // and how it proposes to improve (evolution proposals) — surfaced on Home instead of
  // buried in a separate tab you have to go hunting for.
  const feeds = useMemo<{ did: LearnedItem[]; learned: LearnedItem[] }>(() => {
    const evoAt = (e: { createdAt: string | number }) => (typeof e.createdAt === "number" ? new Date(e.createdAt).toISOString() : e.createdAt);
    const runItems: LearnedItem[] = [...data.runs]
      .filter((r) => r.status === "Completed" && r.completedAt)
      .sort((a, b) => +new Date(b.completedAt!) - +new Date(a.completedAt!))
      .slice(0, 4)
      .map((r) => ({ id: r.id, kind: "did", icon: "CircleCheck", accent: "sage", title: r.outputSummary || r.triggerLabel || "Completed a task", at: r.completedAt!, route: { screen: "activity", params: { tab: "activity" } } }));
    const memItems: LearnedItem[] = [...(data.memories ?? [])]
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
      .slice(0, 4)
      .map((m) => ({ id: m.id, kind: "learned", icon: "Brain", accent: "lavender", title: `Remembered: ${m.title || m.content}`, at: m.updatedAt, route: { screen: "activity", params: { tab: "memory" } } }));
    const evoIds = new Set(serverEvos.map((e) => e.id));
    const allEvos = [...serverEvos, ...(data.evolutions ?? []).filter((e) => !evoIds.has(e.id))];
    const impItems: LearnedItem[] = allEvos
      .filter((e) => e.status === "pending")
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 3)
      .map((e) => ({ id: e.id, kind: "improve", icon: "Sparkles", accent: "ember", title: `Idea: ${e.title}`, at: evoAt(e), route: { screen: "activity", params: { tab: "improvements" } } }));
    // Low-risk improvements the server applied automatically (household opted in) — shown
    // in the ledger with an "Auto-applied by AI" label + the reason it was safe to apply.
    const autoItems: LearnedItem[] = allEvos
      .filter((e) => e.status === "accepted" && (e as ServerEvolution).autoApproved === true)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 3)
      .map((e) => ({ id: e.id, kind: "improve", icon: "Sparkles", accent: "ember", title: `Applied: ${e.title}`, at: evoAt(e), route: { screen: "activity", params: { tab: "improvements" } }, auto: true, note: (e as ServerEvolution).autoReason }));
    // Two honest, separate ledgers: "What I did" (runs — activities) vs "What I learned"
    // (memories + improvement ideas). The activity items intentionally carry no live route
    // here; the render decides clickability by Advanced Mode (the activity log is hidden off it).
    const did = runItems.slice(0, 5);
    const learned = [...impItems, ...autoItems, ...memItems].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 5);
    return { did, learned };
  }, [data.runs, data.memories, data.evolutions, serverEvos, spaceFilter]);

  const saveReminder = () => { if (rTitle.trim()) { createTask({ title: rTitle.trim(), type: "reminder", priority: "medium" }); setRTitle(""); setReminderOpen(false); } };
  const runAsk = () => {
    const t = ask.trim(); if (!t) return;
    void startConversation(t); // → opens a real assistant conversation (NL → plan → approval → run)
    setAsk("");
  };

  const quick: { label: string; icon: string; accent: keyof typeof ACCENT_BG; run: () => void; show: boolean }[] = [
    { label: "New agent", icon: "Bot", accent: "ink", run: () => navigate("agents", { new: "1" }), show: caps.canCreateAgents },
    { label: "New automation", icon: "Workflow", accent: "sage", run: () => navigate("automations", { tab: "builder" }), show: caps.canCreateAgents },
    // Same predicate the route guard uses — an Adult Member used to be offered the tile and
    // bounced straight back with "Not available for your profile".
    { label: "Connect", icon: "Plug", accent: "lavender", run: () => navigate("connections"), show: canAccess("connections") },
    { label: "Upload", icon: "Upload", accent: "amber", run: () => navigate("files", { new: "1" }), show: caps.canUpload },
    { label: "Reminder", icon: "BellPlus", accent: "coral", run: () => setReminderOpen(true), show: true },
    { label: "Template", icon: "Sparkles", accent: "sky", run: () => navigate("automations", { tab: "templates" }), show: caps.canCreateAgents },
  ].filter((q) => q.show);

  // Purpose-built views for children, grandparents, and sitters/helpers (all hooks
  // above have run, so this early return is safe).
  if (caps.viewMode === "child") return <KidView />;
  if (caps.viewMode === "grandparent") return <GrandparentView />;
  if (caps.viewMode === "sitter") return <SitterView />;

  return (
    <div className="space-y-5">
      {/* ───────────────────────── The Hearth (signature) ───────────────────────── */}
      <div className="hearth card-pad animate-scale-in sm:p-7">
        <span className="hearth-glow" aria-hidden="true" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">{fmtDateFull(new Date())}</p>
            <div className="mt-1.5 flex items-center gap-3">
              <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-[2.7rem]">Good {partOfDay}, {firstName}</h1>
              {me && (
                <button onClick={() => setProfileOpen(true)} aria-label="Edit my profile" title="My Profile"
                  className="shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember-300">
                  <MemberAvatar initials={me.initials} color={me.avatarColor} photoFileId={me.photoFileId} size={40} />
                </button>
              )}
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-white/70">
              Here's your household at a glance.{" "}
              {pendingApprovals.length > 0
                ? `${pendingApprovals.length} thing${pendingApprovals.length > 1 ? "s" : ""} need${pendingApprovals.length > 1 ? "" : "s"} your approval.`
                : "Nothing is waiting on you right now."}
            </p>
            {activeSpace && (
              <button onClick={() => setSpaceFilter("all")} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-white/25">
                <Icon name="Filter" size={12} /> Filtered to {activeSpace.name} · clear <Icon name="X" size={12} />
              </button>
            )}
            {caps.canUseAI && (
              <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 p-1.5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)] backdrop-blur">
                <Icon name="Sparkles" size={18} className="ml-2 text-ember-200" />
                <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runAsk()} placeholder="Ask FamiliOS to do something…" aria-label="Ask FamiliOS to do something" className="flex-1 bg-transparent py-2 text-sm text-white placeholder:text-white/50 focus:outline-none" />
                <button onClick={runAsk} className="rounded-xl bg-ember-400 px-3.5 py-2 text-sm font-semibold text-ink-900 shadow-ember transition-transform active:scale-95 hover:bg-ember-300">Go</button>
              </div>
            )}
          </div>
          {/* Family rhythm strip */}
          <div className="shrink-0">
            <p className="mb-2.5 text-xs font-medium uppercase tracking-[0.18em] text-white/45">Your family today</p>
            <div className="flex gap-2.5">
              {data.members.slice(0, 6).map((m) => {
                // "Your family TODAY": today's events for this member plus their open tasks —
                // not every event they were ever on.
                const count = data.events.filter((e) => e.memberIds.includes(m.id) && isTodayEvent(e)).length + data.tasks.filter((t) => t.assignedMemberId === m.id && t.status !== "done").length;
                return (
                  <button key={m.id} onClick={() => navigate("spaces", { tab: "members", member: m.id })} className="group flex flex-col items-center gap-1.5">
                    <span className="relative transition-transform group-hover:-translate-y-0.5">
                      <MemberAvatar initials={m.initials} color={m.avatarColor} photoFileId={m.photoFileId} size={44} />
                      {count > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ember-400 px-1 text-[10px] font-bold text-ink-900 shadow-ember">{count}</span>}
                    </span>
                    <span className="text-[10px] text-white/70">{m.displayName.split(" ")[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ─────────────── Calendar (the key card, directly under Ask) + Needs you ─────────────── */}
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-6">
        <Card className="card-pad lg:col-span-4">
          <Header
            icon="CalendarDays"
            title={`Calendar · ${dayName(new Date().toISOString())}`}
            action={<div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => navigate("calendar", { new: "1" })}><Icon name="Plus" size={14} /> Add</Button>
              <Button size="sm" variant="secondary" onClick={() => navigate("calendar")}>Open calendar</Button>
            </div>}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Today</p>
              {eventsToday.length === 0 ? (
                <div className="well flex items-center gap-2 p-3 text-sm text-ink-500"><Icon name="CalendarCheck" size={15} className="text-sage-500" /> A calm day — nothing scheduled.</div>
              ) : (
                <ol className="space-y-2.5">
                  {eventsToday.map((e) => <EventLine key={e.id} event={e} memberById={memberById} onOpen={() => navigate("calendar", { event: e.id })} />)}
                </ol>
              )}
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Coming up</p>
              {comingUp.length === 0 ? (
                <div className="well flex items-center gap-2 p-3 text-sm text-ink-500"><Icon name="CalendarRange" size={15} className="text-ink-400" /> Nothing on the horizon.</div>
              ) : (
                <ol className="space-y-2.5">
                  {comingUp.map((e) => <EventLine key={e.id} event={e} memberById={memberById} showDay onOpen={() => navigate("calendar", { event: e.id })} />)}
                </ol>
              )}
            </div>
          </div>
        </Card>

        {/* Needs you — approvals + overdue, unified and high on the page */}
        <Card className={`card-pad lg:col-span-2 ${attentionCount > 0 ? "border-amber-200 bg-gradient-to-b from-amber-50/70 to-surface-raised" : ""}`}>
          <Header icon="AlertCircle" title="Needs you" action={attentionCount > 0 ? <Badge color="amber">{attentionCount}</Badge> : undefined} />
          {attentionCount === 0 && openTasks.length === 0 ? <EmptyState icon="CheckCircle2" title="All caught up" message="Nothing needs you right now." /> : (
            <div className="space-y-3">
              {attentionCount > 0 && (
                <ul className="space-y-2">
                  {pendingApprovals.slice(0, 3).map((a) => (
                    <li key={a.id} onClick={() => navigate("messages", { tab: "approvals", approval: a.id })} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-amber-200/70 bg-surface-rim px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-colors hover:bg-amber-50">
                      <Icon name="ShieldAlert" size={16} className="shrink-0 text-amber-600" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{a.preview || a.toolId}</p><p className="text-xs text-amber-600">Approval · {a.risk} risk</p></div>
                    </li>
                  ))}
                  {/* ISS-112: these rows were not clickable at all, and this count spans
                      task TYPES that live on different surfaces — a grocery item counted
                      here while the Chore Board structurally excludes it, so the app
                      insisted items existed with nowhere to see them. Routing is per item
                      (surfaceForTask), because one destination cannot be right for all of
                      them. A type with no home stays unclickable rather than linking
                      somewhere wrong. */}
                  {overdue.slice(0, 3).map((t) => {
                    const to = surfaceForTask(t);
                    // Board-eligible tasks reuse openChoreBoard, which resolves the actual
                    // mini-app id (and seeds it for households that never got one) — the
                    // pure selector can't know a household's ids, only the surface.
                    const go = !to ? null : to.screen === "miniapps" ? openChoreBoard : () => navigate(to.screen, to.params);
                    return (
                      <li
                        key={t.id}
                        {...(go ? { onClick: go } : {})}
                        className={`flex items-center gap-3 rounded-2xl border border-coral-200/70 bg-surface-rim px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ${go ? "cursor-pointer transition-colors hover:bg-coral-50" : ""}`}
                      >
                        <Icon name="Clock" size={16} className="shrink-0 text-coral-600" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{t.title}</p><p className="text-xs text-coral-600">Overdue{t.dueAt ? ` · ${relativeTime(t.dueAt)}` : ""}</p></div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {openTasks.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Open tasks</p>
                  <ul className="space-y-2">
                    {openTasks.slice(0, 4).map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={openChoreBoard}
                          aria-label={`Open task "${t.title}"${t.dueAt ? `, due ${relativeTime(t.dueAt)}` : ", no due date"} — go to the Chore Board`}
                          className="data-row w-full cursor-pointer text-left"
                        >
                          <span className="flex min-w-0 items-center gap-2"><Icon name="CircleDashed" size={14} className="shrink-0 text-sky-500" /><span className="truncate text-sm font-medium text-ink-800">{t.title}</span></span>
                          <span className="shrink-0 text-[11px] text-ink-400">{t.dueAt ? relativeTime(t.dueAt) : "No due date"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ───────────── Ask for or offer help to a family member (human-to-human) ───────────── */}
      {me && <HelpCard me={me} members={data.members} events={data.events} tasks={data.tasks} />}

      {/* ───────────────────────── Quick actions ───────────────────────── */}
      <div className="stagger grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        {quick.map((q, i) => (
          <button key={q.label} onClick={q.run} style={{ ["--i" as string]: i }} className="card lift pressable flex flex-col items-center gap-2 px-2 py-3.5">
            <span className={`flex h-10 w-10 items-center justify-center rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${ACCENT_BG[q.accent]}`}><Icon name={q.icon} size={18} /></span>
            <span className="text-xs font-semibold text-ink-700">{q.label}</span>
          </button>
        ))}
      </div>

      {/* ───────────────────────── Bento: briefing + attention ───────────────────────── */}
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* Briefing (wide) */}
        <Card className="card-pad lg:col-span-4">
          <Header icon="Sun" title="Today's family briefing" action={briefingThread ? <Button size="sm" variant="secondary" onClick={() => navigate("messages", { thread: briefingThread.id })}><Icon name="MessageSquare" size={14} /> Open thread</Button> : undefined} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {briefing.map((s) => (
              <div key={s.label} className="well p-3.5">
                <div className="mb-2 flex items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${ACCENT_BG[s.accent] ?? ACCENT_BG.gray}`}><Icon name={s.icon} size={15} /></span><h4 className="text-sm font-semibold text-ink-800">{s.label}</h4></div>
                <ul className="space-y-1.5">{s.items.map((it, i) => <li key={i} className="flex items-start gap-2 text-sm text-ink-600"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${(ACCENT_BG[s.accent] ?? ACCENT_BG.gray).split(" ")[0]}`} /><span>{it}</span></li>)}</ul>
              </div>
            ))}
          </div>
        </Card>

        {/* What I did — the activity ledger. NOT clickable unless Advanced Mode is on (the
            raw Activity Log it links to is hidden off Advanced Mode); read-only otherwise. */}
        <Card className="card-pad lg:col-span-1">
          <Header icon="CircleCheck" title="What I did" action={advanced ? <button onClick={() => navigate("activity", { tab: "activity" })} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">All</button> : undefined} />
          {feeds.did.length === 0 ? <EmptyState icon="CircleCheck" title="Nothing yet" message="As your helpers run, what they do shows up here." /> : (
            <ul className="space-y-2">
              {feeds.did.map((it) => {
                const clickable = advanced;
                return (
                  <li key={it.id}
                    {...(clickable ? { onClick: () => navigate("activity", { tab: "activity" }) } : {})}
                    className={`flex items-start gap-2.5 rounded-2xl border border-transparent px-2 py-1.5 ${clickable ? "group cursor-pointer transition-colors hover:border-ink-900/[0.06] hover:bg-surface-overlay" : "cursor-default"}`}>
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${FEED_ACCENT[it.accent]}`}><Icon name={it.icon} size={14} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm text-ink-700">{it.title}</p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400"><span>Done · {relativeTime(it.at)}</span></div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* What I learned — memories + improvement ideas. Clickable to Memory / Improvements. */}
        <Card className="card-pad lg:col-span-1">
          <Header icon="Brain" title="What I learned" action={<button onClick={() => navigate("activity", { tab: "memory" })} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">All</button>} />
          {feeds.learned.length === 0 ? <EmptyState icon="Brain" title="Nothing yet" message="What FamiliOS remembers and learns shows up here." /> : (
            <ul className="space-y-2">
              {feeds.learned.map((it) => (
                <li key={it.id} onClick={() => navigate(it.route.screen as ScreenId, it.route.params)} className="group flex cursor-pointer items-start gap-2.5 rounded-2xl border border-transparent px-2 py-1.5 transition-colors hover:border-ink-900/[0.06] hover:bg-surface-overlay">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${FEED_ACCENT[it.accent]}`}><Icon name={it.icon} size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-ink-700">{it.title}</p>
                    {it.auto && it.note && <p className="line-clamp-2 text-[11px] text-ink-500">{it.note}</p>}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
                      {it.auto
                        ? <Badge color="lavender"><Icon name="Sparkles" size={9} /> Auto-applied by AI</Badge>
                        : <span>{it.kind === "learned" ? "Remembered" : "Suggestion"}</span>}
                      <span>· {relativeTime(it.at)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ───────────────────────── Bento: agents · systems ───────────────────────── */}
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* Active agents */}
        <Card className="card-pad lg:col-span-3">
          <Header icon="Bot" title="Helper agents" action={<button onClick={() => navigate("agents")} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">All</button>} />
          {/* Backend-owned agents can't be confirmed while offline — say so plainly instead
              of showing the same "no active agents" empty state a genuinely-fresh household
              would see (T-02: distinguish "unreachable" from "genuinely empty"). */}
          {!backendOnline && activeAgents.length === 0 && (
            <div className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-600">Backend runtime offline — can't confirm helper agent status right now.</div>
          )}
          {activeAgents.length === 0 ? <EmptyState icon="Bot" title="No active agents" message="Create your first helper." /> : (
            <ul className="space-y-2">
              {activeAgents.slice(0, 4).map((a) => (
                <li key={a.id} onClick={() => navigate("agents", { id: a.id })} className="data-row cursor-pointer">
                  <span className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"><Icon name={a.icon} size={16} /></span><span className="text-sm font-medium text-ink-800">{a.name}</span></span>
                  <StatusDot color={a.status === "Active" ? "sage" : "coral"} pulse={a.status === "Active"} label={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Connected systems health (REAL) */}
        <Card className="card-pad lg:col-span-3">
          <Header icon="Plug" title="Connected systems" action={<button onClick={() => navigate("connections")} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">Manage</button>} />
          {!backendOnline && <div className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-600">Backend runtime offline — start it with <code>npm run dev</code>.</div>}
          <ul className="space-y-1.5">
            {(liveConnectors.length ? liveConnectors : connectors).slice(0, 5).map((c) => (
              <li key={c.id} onClick={() => navigate("connections", { id: c.id })} className="data-row cursor-pointer">
                <span className="flex items-center gap-2 text-sm font-medium text-ink-800"><Icon name="Plug" size={14} className="text-ink-400" />{c.name}</span>
                <ReadinessBadge readiness={c.readiness} />
              </li>
            ))}
            {connectors.length === 0 && <li className="text-sm text-ink-400">No connectors loaded.</li>}
          </ul>
        </Card>
      </div>

      {/* ───────────────────────── Bento: suggestions + recent ───────────────────────── */}
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* Suggested next actions (wide) */}
        <Card className="card-pad lg:col-span-4">
          <Header icon="Sparkles" title="Suggested next actions" />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => navigate(s.route.screen as ScreenId, s.route.params)} className="group flex items-center gap-3 rounded-2xl border border-ink-900/[0.06] bg-surface-rim px-3.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-all hover:-translate-y-0.5 hover:border-ember-200 hover:shadow-e2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ember-50 text-ember-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={s.icon} size={18} /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{s.title}</p><p className="truncate text-xs text-ink-500">{s.detail}</p></div>
                <Icon name="ChevronRight" size={16} className="shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </Card>

        {/* Recent files + messages (narrow column) */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="card-pad">
            <Header icon="FolderOpen" title="Recent documents" action={<button onClick={() => navigate("files")} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">All</button>} />
            <ul className="space-y-1.5">
              {recentFiles.map((f) => (
                <li key={f.id} onClick={() => navigate("files", { file: f.id })} className="data-row cursor-pointer">
                  <span className="flex min-w-0 items-center gap-2"><Icon name="FileText" size={15} className="shrink-0 text-amber-600" /><span className="truncate text-sm text-ink-800">{f.name}</span></span>
                  {f.sensitive && <Icon name="Lock" size={13} className="shrink-0 text-lavender-600" />}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="card-pad">
            <Header icon="MessagesSquare" title="Family messages" action={<button onClick={() => navigate("messages")} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">Inbox</button>} />
            <ul className="space-y-1.5">
              {recentThreads.map((t) => (
                <li key={t.id} onClick={() => navigate("messages", { thread: t.id })} className="data-row cursor-pointer">
                  <span className="flex min-w-0 items-center gap-2">{t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />}<span className={`truncate text-sm ${t.unread ? "font-bold text-ink-900" : "text-ink-700"}`}>{t.title}</span></span>
                  <span className="shrink-0 text-[11px] text-ink-400">{relativeTime(t.updatedAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Modal open={reminderOpen} onClose={() => setReminderOpen(false)} title="Create a reminder" icon="BellPlus" footer={<><Button variant="ghost" onClick={() => setReminderOpen(false)}>Cancel</Button><Button variant="ember" onClick={saveReminder} disabled={!rTitle.trim()}><Icon name="Plus" size={16} /> Add</Button></>}>
        <Field label="What's the reminder?"><TextInput autoFocus value={rTitle} onChange={(e) => setRTitle(e.target.value)} placeholder="e.g. Sign the field-trip slip" /></Field>
        <p className="mt-3 text-xs text-ink-400">Saved locally to your household.</p>
      </Modal>

      {profileOpen && me && <ProfileEditor member={me} onClose={() => setProfileOpen(false)} />}
    </div>
  );
}

/* ─────────────── Ask for or offer help to a family member (human-to-human) ─────────────── *
 * The composer (shared with KidView) does both directions: ASK a member to help with one
 * of MY events, or OFFER to help with one of THEIR events/tasks. Pending requests addressed
 * to ME are answerable inline; my outgoing ones are cancellable. Offers and asks are worded
 * distinctly on both sides. */
function HelpCard({ me, members, events, tasks }: { me: Member; members: Member[]; events: CalendarEvent[]; tasks: Task[] }) {
  const toast = useStore((s) => s.toast);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = async () => setRequests(await backend.helpRequests());
  useEffect(() => { void reload(); }, []);

  const others = members.filter((m) => m.id !== me.id);

  // The event or task a request is about, for "…help with {item}" wording.
  const itemLabelFor = (r: HelpRequest): string | null => {
    if (r.eventId) { const e = events.find((x) => (x.serverId ?? x.id) === r.eventId); if (e) return e.title; }
    if (r.taskId) { const t = tasks.find((x) => (x.serverId ?? x.id) === r.taskId); if (t) return t.title; }
    return null;
  };

  const respond = async (r: HelpRequest, response: "accept" | "decline") => {
    setBusy(true);
    const res = await backend.respondHelpRequest(r.id, response);
    setBusy(false);
    if (res.error) toast({ kind: "error", title: "Couldn't respond", message: res.message ?? res.error });
    await reload();
  };
  const cancel = async (r: HelpRequest) => {
    setBusy(true);
    const res = await backend.cancelHelpRequest(r.id);
    setBusy(false);
    if (res.error) toast({ kind: "error", title: "Couldn't cancel", message: res.message ?? res.error });
    await reload();
  };

  const incoming = requests.filter((r) => r.status === "pending" && r.toActorId === me.id);
  const outgoing = requests.filter((r) => r.status === "pending" && r.fromActorId === me.id);

  return (
    <Card className="card-pad">
      <Header icon="HeartHandshake" title="Ask for or offer help" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HelpComposer me={me} people={others} events={events} tasks={tasks} onSent={reload} />
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">For you</p>
            {incoming.length === 0 ? <p className="text-xs text-ink-400">Nothing waiting on you.</p> : (
              <ul className="space-y-2">
                {incoming.map((r) => {
                  const item = itemLabelFor(r);
                  return (
                    <li key={r.id} className="rounded-2xl border border-amber-200/70 bg-amber-50/60 px-3 py-2">
                      <p className="text-sm text-ink-800">
                        <span className="font-semibold">{r.fromName}</span>{" "}
                        {r.kind === "offer" ? "offered to help" : "asked you to help"}
                        {item ? <> with <span className="font-semibold">{item}</span></> : null}
                      </p>
                      {r.message && <p className="mt-0.5 text-xs text-ink-500">“{r.message}”</p>}
                      <div className="mt-1.5 flex gap-2">
                        <Button size="sm" variant="success" disabled={busy} onClick={() => void respond(r, "accept")}><Icon name="Check" size={12} /> Accept</Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void respond(r, "decline")}><Icon name="X" size={12} /> Decline</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Your open requests</p>
            {outgoing.length === 0 ? <p className="text-xs text-ink-400">You haven't asked for or offered help yet.</p> : (
              <ul className="space-y-2">
                {outgoing.map((r) => {
                  const item = itemLabelFor(r);
                  return (
                    <li key={r.id} className="flex items-center gap-2 rounded-2xl border border-ink-900/[0.06] bg-surface-rim px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-800">
                          {r.kind === "offer"
                            ? <>You offered to help <span className="font-semibold">{r.toName}</span>{item ? <> with {item}</> : null}</>
                            : <>To <span className="font-semibold">{r.toName}</span>: {r.message}</>}
                        </p>
                        <p className="text-[11px] text-ink-400">Waiting for an answer · {relativeTime(r.createdAt)}</p>
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel(r)}><Icon name="X" size={12} /> Cancel</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Header({ icon, title, action }: { icon: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name={icon} size={14} /> {title}</h3>
      {action}
    </div>
  );
}

/** A compact calendar row for the Today card: time (+ weekday for "coming up"), title,
 *  location, and per-family-member colored dots (member.avatarColor → the shared accent
 *  palette), so a glance shows both when a thing is and who it's for. */
function EventLine({ event, memberById, showDay, onOpen }: { event: CalendarEvent; memberById: Map<string, Member>; showDay?: boolean; onOpen: () => void }) {
  const members = event.memberIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m);
  return (
    <li onClick={onOpen} className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-transparent px-2 py-1.5 transition-colors hover:border-ink-900/[0.06] hover:bg-surface-overlay">
      <div className="flex w-12 shrink-0 flex-col items-center leading-tight">
        {showDay && <span className="text-[10px] font-semibold uppercase text-ink-400">{dayName(event.startAt).slice(0, 3)}</span>}
        <span className="text-xs font-semibold text-ink-700">{eventTimeLabel(event)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-800">{event.title}</p>
        {event.location && <p className="truncate text-xs text-ink-500">{event.location}</p>}
      </div>
      <MemberDots members={members.map((m) => ({ id: m.id, name: m.displayName, color: m.avatarColor }))} max={4} />
    </li>
  );
}
