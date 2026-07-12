import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, Badge, Drawer, Field, TextInput, TextArea, Select, MemberDots } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ACCENT_HEX } from "@/components/MemberAvatar";
import { backend, type ServerEvent, type BackendApproval, type CalendarSubscription } from "@/connectors/api";

/** A calendar item's per-member colored dots (the "color-coded per user" cue). */
type MemberDot = { id: string; color: string; name: string };

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
/** Render event notes with clickable links (recipe URLs, mini-app references). */
function linkifyNotes(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer" className="font-semibold text-sky-700 underline break-all">{part}</a>
      : <span key={i}>{part}</span>,
  );
}
const toLocalInput = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(+d)) return ""; const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** A pull flagged this event: both FamiliOS and Google changed it since the last push/merge. */
type SyncConflict = { at: number; googleUpdated: string | null; google: { title?: string; startAt?: string | null; endAt?: string | null; location?: string } };
const conflictOf = (ev: ServerEvent): SyncConflict | null => ((ev.provenance as { conflict?: SyncConflict } | undefined)?.conflict ?? null);

/** Calendar — the home for the rich family-event model (P4.1) and the three-layer
 *  calendar (P4.2): FamiliOS-owned "canonical" events are editable + pushable to Google;
 *  "linked" events (Google/ICS subscriptions) are read-only (copy to edit).
 *  Phase 3 polish: list ⇄ month grid toggle, editable participants/driver/what-to-bring/
 *  checklist in the drawer, and one-step inline approval for Google push. */
export function Calendar() {
  const toast = useStore((s) => s.toast);
  const role = useStore((s) => s.session?.role);
  const members = useStore((s) => s.data.members);
  const canManage = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(role ?? "");
  const nameOf = (id?: string | null) => (id ? members.find((m) => m.id === id)?.displayName ?? id : null);
  const dotsFor = (ev: ServerEvent): MemberDot[] => (ev.participantIds ?? []).map((id) => ({ id, color: members.find((m) => m.id === id)?.avatarColor ?? "gray", name: nameOf(id) ?? "" }));
  const hexOf = (memberId?: string | null) => {
    const m = memberId ? members.find((x) => x.id === memberId) : undefined;
    return m ? ACCENT_HEX[m.avatarColor] ?? null : null;
  };

  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [selected, setSelected] = useState<ServerEvent | null>(null);
  const [view, setView] = useState<"list" | "month">("list");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(toLocalInput(new Date().toISOString()));
  const [location, setLocation] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const syncInFlight = useRef(false);
  // Subscriptions feed the per-event owner colors (subscriptionId → ownerActorId → accent),
  // so shared events can render a two-owner gradient.
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);

  const load = async () => setEvents(await backend.events());
  useEffect(() => { void load(); void backend.calendarSubscriptions().then(setSubs); }, []);

  const conflictCount = useMemo(() => events.filter((e) => conflictOf(e)).length, [events]);
  // One "Sync" button: re-sync every subscribed calendar AND pull Google-side edits.
  const doSync = useCallback(async (silent = false) => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    const r = await backend.syncAllCalendars();
    syncInFlight.current = false;
    setSyncing(false);
    if (r.ok) {
      await load();
      void backend.calendarSubscriptions().then(setSubs);
      setLastSyncAt(new Date());
      if (!silent) {
        const p = r.pulled ?? {};
        const bits = [
          r.imported ? `${r.imported} new` : null,
          r.updated ? `${r.updated} updated` : null,
          r.removed ? `${r.removed} removed` : null,
          p.merged ? `${p.merged} merged from Google` : null,
          p.conflicts ? `${p.conflicts} conflict${p.conflicts === 1 ? "" : "s"} to review` : null,
        ].filter(Boolean);
        toast({ kind: p.conflicts ? "warn" : "success", title: `Synced ${r.synced ?? 0} calendar${(r.synced ?? 0) === 1 ? "" : "s"}`, message: bits.length ? bits.join(" · ") : "Everything is up to date." });
      }
    } else if (!silent) {
      toast({ kind: "warn", title: "Couldn't sync", message: r.message ?? (r.error === "no_account" ? "Connect your Google account (with calendar access) in Connections first." : r.error) });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-sync while the Calendar screen is mounted (~every 60s; skipped if one is in flight).
  useEffect(() => {
    const t = window.setInterval(() => { void doSync(true); }, 60_000);
    return () => window.clearInterval(t);
  }, [doSync]);

  const upcoming = useMemo(() => events
    .filter((e) => !e.startAt || new Date(e.startAt).getTime() >= Date.now() - 12 * 3600e3)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))), [events]);
  const byDay = useMemo(() => {
    const map: Record<string, ServerEvent[]> = {};
    for (const e of upcoming) { const k = e.startAt ? dayKey(e.startAt) : "undated"; (map[k] ??= []).push(e); }
    return map;
  }, [upcoming]);
  const days = Object.keys(byDay).filter((k) => k !== "undated").sort();
  // Month view needs ALL dated events (including past days of the visible month).
  const byDayAll = useMemo(() => {
    const map: Record<string, ServerEvent[]> = {};
    for (const e of events) { if (!e.startAt || isNaN(+new Date(e.startAt))) continue; (map[dayKey(e.startAt)] ??= []).push(e); }
    for (const k of Object.keys(map)) map[k].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
    return map;
  }, [events]);

  // Per-event member colors: the owner member's accent drives the row bar / month dot.
  // Shared events (present in ≥2 subscriptions) get a two-owner gradient.
  const colorsFor = (ev: ServerEvent): string[] => {
    const prov = (ev.provenance ?? {}) as { subscriptionId?: string; alsoSubscriptionIds?: string[] };
    const sourceIds = [prov.subscriptionId, ...(prov.alsoSubscriptionIds ?? [])].filter((x): x is string => !!x);
    if (sourceIds.length >= 2) {
      const ownerHexes = [...new Set(sourceIds
        .map((sid) => subs.find((s) => s.id === sid)?.ownerActorId)
        .map((aid) => hexOf(aid))
        .filter((c): c is string => !!c))];
      if (ownerHexes.length >= 2) return ownerHexes.slice(0, 2);
    }
    const primary = hexOf(ev.ownerId) ?? hexOf((ev.participantIds ?? [])[0]);
    if (primary) return [primary];
    // Fall back to the layer colors (ember = FamiliOS, sky = synced, gray = public).
    return [ev.layer === "linked" ? "#6fa6d6" : ev.layer === "public" ? "#c2c7d1" : "#ce5d1d"];
  };

  const add = async () => {
    if (!title.trim()) return; setBusy(true);
    const r = await backend.createEvent({ title: title.trim(), startAt: start ? new Date(start).toISOString() : null, location, visibility: "household" });
    setBusy(false);
    if (r.event) { setTitle(""); setLocation(""); await load(); toast({ kind: "success", title: "Event added" }); }
    else toast({ kind: "error", title: "Couldn't add", message: r.error === "insufficient_role" ? "Adults only." : r.error });
  };
  const refreshSelected = async (id: string) => { const list = await backend.events(); setEvents(list); setSelected(list.find((e) => e.id === id) ?? null); };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Calendar" subtitle="Your household's events. FamiliOS events are yours to edit and push to Google; synced feeds are read-only." icon="CalendarDays" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-ink-900/[0.08] bg-surface-sunken/60 p-0.5" role="tablist" aria-label="Calendar view">
          {(["list", "month"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded-[10px] px-3.5 py-1.5 text-sm font-semibold capitalize transition-colors ${view === v ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"}`}>
              <Icon name={v === "list" ? "List" : "LayoutGrid"} size={13} className="mr-1 inline" />{v}
            </button>
          ))}
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" disabled={syncing} onClick={() => void doSync()} title="Sync every subscribed calendar and pull Google-side edits">
            <Icon name={syncing ? "Loader2" : "RefreshCw"} size={13} className={syncing ? "animate-spin" : ""} /> Sync
          </Button>
        )}
        {lastSyncAt && <span className="text-xs text-ink-400">Last synced {lastSyncAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>}
        {conflictCount > 0 && <Badge color="coral"><Icon name="AlertTriangle" size={10} /> {conflictCount} conflict{conflictCount === 1 ? "" : "s"} to review</Badge>}
      </div>

      {canManage && (
        <Card className="card-pad mb-5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <Field label="Event" className="sm:col-span-2"><TextInput value={title} placeholder="Soccer practice" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} /></Field>
            <Field label="When"><TextInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Location"><TextInput value={location} placeholder="Field 3" onChange={(e) => setLocation(e.target.value)} /></Field>
          </div>
          <div className="mt-3"><Button variant="ember" disabled={busy || !title.trim()} onClick={add}><Icon name="Plus" size={15} /> Add event</Button></div>
        </Card>
      )}

      {view === "month" ? (
        <MonthGrid byDay={byDayAll} nameOf={nameOf} dotsFor={dotsFor} colorsFor={colorsFor} onOpen={setSelected} />
      ) : upcoming.length === 0 ? (
        <Card className="card-pad"><p className="text-sm text-ink-400">Nothing on the calendar yet. Add an event, subscribe to a calendar in Connections, or connect Google.</p></Card>
      ) : (
        <div className="space-y-3">
          {days.map((k) => (
            <Card key={k} className="card-pad">
              <p className="mb-2 font-display text-sm font-semibold text-ink-900">{new Date(k + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}{k === new Date().toISOString().slice(0, 10) && <span className="ml-2 text-xs font-normal text-ember-600">Today</span>}</p>
              <ul className="space-y-1.5">{byDay[k].map((e) => <EventRow key={e.id} ev={e} driver={nameOf(e.driverId)} dots={dotsFor(e)} colors={colorsFor(e)} onOpen={() => setSelected(e)} />)}</ul>
            </Card>
          ))}
          {byDay["undated"] && <Card className="card-pad"><p className="mb-2 font-display text-sm font-semibold text-ink-900">No date set</p><ul className="space-y-1.5">{byDay["undated"].map((e) => <EventRow key={e.id} ev={e} driver={nameOf(e.driverId)} dots={dotsFor(e)} colors={colorsFor(e)} onOpen={() => setSelected(e)} />)}</ul></Card>}
        </div>
      )}

      {/* key: remount when the server copy changes (save / conflict-resolve) so the drawer's
          edit fields re-seed — otherwise a post-resolve Save would clobber the chosen version. */}
      {selected && <EventDrawer key={`${selected.id}:${selected.updatedAt}`} ev={selected} canManage={canManage} members={members.map((m) => ({ id: m.id, name: m.displayName }))} nameOf={nameOf} onClose={() => setSelected(null)} onChanged={refreshSelected} onGone={async () => { setSelected(null); await load(); }} />}
    </div>
  );
}

/* ---- Month grid (Phase 3): a 7-column month with per-day event chips ---- */
function MonthGrid({ byDay, nameOf, dotsFor, colorsFor, onOpen }: { byDay: Record<string, ServerEvent[]>; nameOf: (id?: string | null) => string | null; dotsFor: (ev: ServerEvent) => MemberDot[]; colorsFor: (ev: ServerEvent) => string[]; onOpen: (e: ServerEvent) => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selDay, setSelDay] = useState<string | null>(null);

  const first = new Date(cursor.y, cursor.m, 1);
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const lead = first.getDay(); // 0 = Sunday
  const todayKey = today.toISOString().slice(0, 10);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const p = (n: number) => String(n).padStart(2, "0");
      return `${cursor.y}-${p(cursor.m + 1)}-${p(i + 1)}`;
    }),
  ];
  const move = (d: number) => { const dt = new Date(cursor.y, cursor.m + d, 1); setCursor({ y: dt.getFullYear(), m: dt.getMonth() }); setSelDay(null); };

  return (
    <div className="space-y-3">
      <Card className="card-pad">
        <div className="mb-3 flex items-center justify-between">
          <Button size="sm" variant="ghost" onClick={() => move(-1)} aria-label="Previous month"><Icon name="ChevronLeft" size={15} /></Button>
          <p className="font-display text-sm font-semibold text-ink-900">{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
          <Button size="sm" variant="ghost" onClick={() => move(1)} aria-label="Next month"><Icon name="ChevronRight" size={15} /></Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <p key={d} className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{d}</p>)}
          {cells.map((k, i) => k === null ? <div key={`b${i}`} /> : (
            <button key={k} onClick={() => setSelDay(selDay === k ? null : k)}
              aria-label={`${new Date(k + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}, ${(byDay[k]?.length ?? 0)} events`}
              className={`min-h-[3.4rem] rounded-lg border p-1 text-left align-top transition-colors ${selDay === k ? "border-ember-400 bg-ember-50/70" : k === todayKey ? "border-ember-200 bg-surface" : "border-ink-900/[0.05] bg-surface-sunken/40 hover:border-ember-200"}`}>
              <span className={`text-xs font-semibold ${k === todayKey ? "text-ember-600" : "text-ink-700"}`}>{Number(k.slice(8, 10))}</span>
              <span className="mt-0.5 flex flex-wrap gap-0.5">
                {(byDay[k] ?? []).slice(0, 3).map((e) => (
                  <span key={e.id} title={e.title} className="h-1.5 w-1.5 rounded-full" style={{ background: barBackground(colorsFor(e)) }} />
                ))}
                {(byDay[k]?.length ?? 0) > 3 && <span className="text-[10px] leading-none text-ink-400">+{(byDay[k]?.length ?? 0) - 3}</span>}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-400">Dots are colored by each event owner's member color; two-tone dots are shared between two calendars.</p>
      </Card>
      {selDay && (
        <Card className="card-pad">
          <p className="mb-2 font-display text-sm font-semibold text-ink-900">{new Date(selDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
          {(byDay[selDay] ?? []).length === 0
            ? <p className="text-sm text-ink-400">Nothing scheduled this day.</p>
            : <ul className="space-y-1.5">{(byDay[selDay] ?? []).map((e) => <EventRow key={e.id} ev={e} driver={nameOf(e.driverId)} dots={dotsFor(e)} colors={colorsFor(e)} onOpen={() => onOpen(e)} />)}</ul>}
        </Card>
      )}
    </div>
  );
}

/** Solid color for one owner; a two-stop gradient when an event is shared by two. */
const barBackground = (colors: string[]) =>
  colors.length > 1 ? `linear-gradient(180deg, ${colors[0]} 0%, ${colors[0]} 48%, ${colors[1]} 52%, ${colors[1]} 100%)` : colors[0];

function EventRow({ ev, driver, dots, colors, onOpen }: { ev: ServerEvent; driver: string | null; dots: MemberDot[]; colors: string[]; onOpen: () => void }) {
  const time = ev.startAt && !isNaN(+new Date(ev.startAt)) ? new Date(ev.startAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-center gap-2.5 rounded-xl border border-ink-900/[0.05] bg-surface-sunken/50 px-3 py-2 text-left transition-colors hover:border-ember-200" aria-label={`Open ${ev.title}`}>
        <span aria-hidden="true" className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: barBackground(colors) }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-800">{ev.title} {conflictOf(ev) && <Badge color="coral"><Icon name="AlertTriangle" size={10} /> Sync conflict</Badge>}</p>
          <p className="truncate text-xs text-ink-500">{time ?? "All day"}{ev.location ? ` · ${ev.location}` : ""}{driver ? ` · Driver: ${driver}` : ""}{ev.source && ev.layer === "linked" ? ` · ${ev.source}` : ""}</p>
        </div>
        <MemberDots members={dots} />
        <Icon name="ChevronRight" size={15} className="shrink-0 text-ink-300" />
      </button>
    </li>
  );
}

function EventDrawer({ ev, canManage, members, nameOf, onClose, onChanged, onGone }: { ev: ServerEvent; canManage: boolean; members: { id: string; name: string }[]; nameOf: (id?: string | null) => string | null; onClose: () => void; onChanged: (id: string) => Promise<void>; onGone: () => Promise<void> }) {
  const toast = useStore((s) => s.toast);
  const linked = ev.layer === "linked" || ev.layer === "public";
  // Server verdict wins: editable === false → fully read-only for THIS member (e.g. a
  // linked Google event someone else connected). editable === true → editable even if
  // linked (it's the member who connected that account). Undefined → legacy layer rule.
  const readOnly = ev.editable === false;
  const canEdit = !readOnly && canManage && (ev.editable === true || !linked);
  const [title, setTitle] = useState(ev.title);
  const [location, setLocation] = useState(ev.location ?? "");
  const [notes, setNotes] = useState(ev.notes ?? "");
  const [start, setStart] = useState(toLocalInput(ev.startAt));
  // Phase 3: the rich model is editable, not just displayed.
  const [participantIds, setParticipantIds] = useState<string[]>(ev.participantIds ?? []);
  const [driverId, setDriverId] = useState<string>(ev.driverId ?? "");
  const [bring, setBring] = useState<{ item: string; memberId: string | null }[]>(ev.whatToBring ?? []);
  const [bringItem, setBringItem] = useState("");
  const [bringWho, setBringWho] = useState("");
  const [checklist, setChecklist] = useState<{ text: string; done: boolean }[]>(ev.checklist ?? []);
  const [checkText, setCheckText] = useState("");
  const [busy, setBusy] = useState(false);
  // One-step Google push: the approval renders inline, right here in the drawer.
  const [pushApproval, setPushApproval] = useState<BackendApproval | null>(null);

  const toggleParticipant = (id: string) => setParticipantIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async () => {
    setBusy(true);
    const r = await backend.updateEvent(ev.id, {
      title, location, notes, startAt: start ? new Date(start).toISOString() : null,
      participantIds, driverId: driverId || null, whatToBring: bring, checklist,
    });
    setBusy(false);
    if (r.event) { await onChanged(ev.id); toast({ kind: "success", title: "Saved" }); }
    else toast({ kind: "error", title: "Couldn't save", message: r.error });
  };
  const del = async () => { setBusy(true); await backend.deleteEvent(ev.id); setBusy(false); await onGone(); toast({ kind: "info", title: "Event removed" }); };
  const copy = async () => { setBusy(true); const r = await backend.createEvent({ title: ev.title, startAt: ev.startAt, endAt: ev.endAt, location: ev.location, participantIds: ev.participantIds, visibility: "household" }); setBusy(false); if (r.event) { await onGone(); toast({ kind: "success", title: "Copied to a FamiliOS event", message: "Now editable." }); } };

  const push = async (approvalId?: string) => {
    setBusy(true);
    const r = await backend.pushEventToGoogle(ev.id, approvalId);
    setBusy(false);
    if (r.ok) { setPushApproval(null); await onChanged(ev.id); toast({ kind: "success", title: `Google Calendar ${r.action ?? "updated"}` }); }
    else if (r.needsApproval && r.approval) { setPushApproval(r.approval); }
    else toast({ kind: "warn", title: "Couldn't push", message: r.message ?? (r.error === "connect_google_first" ? "Connect Google in Connections first." : r.error) });
  };
  // One interaction once the panel is shown: approve through the same server gate,
  // then immediately execute the push with the consumed approval.
  const approveAndPush = async () => {
    if (!pushApproval) return;
    setBusy(true);
    const d = await backend.decideApproval(pushApproval.id, true);
    setBusy(false);
    if (d.error || !d.approval) { toast({ kind: "error", title: "Couldn't approve", message: d.error ?? "Approval failed — try the approvals console in Messages." }); return; }
    await push(pushApproval.id);
  };
  const denyPush = async () => {
    if (!pushApproval) return;
    setBusy(true);
    await backend.decideApproval(pushApproval.id, false);
    setBusy(false);
    setPushApproval(null);
    toast({ kind: "info", title: "Push cancelled" });
  };
  // Conflict review: both sides changed since the last push/merge — the user picks.
  const conflict = conflictOf(ev);
  const resolve = async (choice: "google" | "local") => {
    setBusy(true);
    const r = await backend.resolveEventConflict(ev.id, choice);
    setBusy(false);
    if (r.ok) {
      await onChanged(ev.id);
      toast({ kind: "success", title: choice === "google" ? "Google's version applied" : "Kept your FamiliOS version", message: choice === "local" ? "Google still has its own version — push the event to update it." : undefined });
    } else toast({ kind: "error", title: "Couldn't resolve", message: r.message ?? r.error });
  };

  return (
    <Drawer open onClose={onClose} icon="Calendar" title={ev.title}
      footer={canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={save}><Icon name="Save" size={14} /> Save</Button>
          {!linked && <Button variant="secondary" disabled={busy || !!pushApproval} onClick={() => push()}><Icon name="Upload" size={14} /> {ev.provenance?.googleEventId ? "Update in Google" : "Push to Google"}</Button>}
          <Button variant="ghost" disabled={busy} onClick={del}><Icon name="Trash2" size={14} /> Delete</Button>
        </div>
      ) : canManage && linked ? <Button variant="ember" disabled={busy} onClick={copy}><Icon name="Copy" size={14} /> Copy to a FamiliOS event</Button> : undefined}>
      <div className="space-y-4">
        {readOnly && <p className="rounded-2xl border border-ink-900/[0.06] bg-surface-sunken/60 px-3.5 py-2.5 text-sm text-ink-500"><Icon name="Lock" size={13} className="mr-1 inline" /> Read-only — synced from {nameOf(ev.ownerId) ?? ev.source ?? "another member"}'s calendar.</p>}
        {linked && !readOnly && !canEdit && <p className="rounded-2xl border border-sky-200/70 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-800"><Icon name="RefreshCw" size={13} className="mr-1 inline" /> Synced from {ev.source || "an external calendar"} — read-only here. Copy it to make an editable FamiliOS event.</p>}

        {conflict && (
          <div className="rounded-xl border border-coral-200/80 bg-coral-50/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink-800"><Icon name="AlertTriangle" size={14} className="text-coral-600" /> This event changed in two places</p>
            <p className="mb-2 text-xs text-ink-600">It was edited both here and in Google Calendar since the last sync. Pick the version to keep — nothing is overwritten until you choose.</p>
            <div className="mb-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-ink-900/[0.06] bg-surface px-2.5 py-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">FamiliOS version</p>
                <p className="text-sm font-medium text-ink-800">{ev.title}</p>
                <p className="text-xs text-ink-500">{ev.startAt ? new Date(ev.startAt).toLocaleString() : "No date"}{ev.location ? ` · ${ev.location}` : ""}</p>
              </div>
              <div className="rounded-lg border border-ink-900/[0.06] bg-surface px-2.5 py-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Google version</p>
                <p className="text-sm font-medium text-ink-800">{conflict.google.title ?? ev.title}</p>
                <p className="text-xs text-ink-500">{conflict.google.startAt ? new Date(conflict.google.startAt).toLocaleString() : "No date"}{conflict.google.location ? ` · ${conflict.google.location}` : ""}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => resolve("local")}><Icon name="Home" size={13} /> Keep FamiliOS version</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => resolve("google")}><Icon name="Download" size={13} /> Use Google version</Button>
            </div>
          </div>
        )}

        {pushApproval && (
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <div className="mb-1 flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-ink-800">Push “{ev.title}” to your Google Calendar?</p>
              <Badge color="amber">{pushApproval.risk}</Badge>
            </div>
            {pushApproval.preview && <p className="mb-2 text-xs text-ink-600">{pushApproval.preview}</p>}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="success" disabled={busy} onClick={approveAndPush}><Icon name={busy ? "Loader2" : "Check"} size={13} className={busy ? "animate-spin" : ""} /> Approve &amp; push</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={denyPush}><Icon name="X" size={13} /> Deny</Button>
            </div>
          </div>
        )}

        {canEdit ? (
          <div className="space-y-2.5">
            <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="When"><TextInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Location"><TextInput value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
            <Field label="Details" hint="Synced as the event description on Google Calendar"><TextArea rows={5} value={notes} placeholder="Context, links, ingredients, instructions…" onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        ) : (
          <div className="text-sm text-ink-600">
            <p><span className="text-ink-400">When:</span> {ev.startAt ? new Date(ev.startAt).toLocaleString() : "No date set"}</p>
            {ev.location && <p><span className="text-ink-400">Where:</span> {ev.location}</p>}
            {ev.notes && <div className="mt-1.5 whitespace-pre-wrap rounded-lg bg-surface-sunken/50 p-2 text-xs text-ink-600">{linkifyNotes(ev.notes)}</div>}
          </div>
        )}

        {/* Rich family-event model — editable for canonical events (Phase 3) */}
        {canEdit && !linked ? (
          <>
            <div>
              <p className="section-title mb-1.5">Participants</p>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const on = participantIds.includes(m.id);
                  return (
                    <button key={m.id} onClick={() => toggleParticipant(m.id)} aria-pressed={on}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${on ? "border-ember-400 bg-ember-50 text-ember-700" : "border-ink-900/[0.08] bg-surface-sunken/60 text-ink-500 hover:text-ink-700"}`}>
                      {on && <Icon name="Check" size={10} className="mr-0.5 inline" />}{m.name}
                    </button>
                  );
                })}
                {members.length === 0 && <p className="text-xs text-ink-400">No household members loaded.</p>}
              </div>
            </div>
            <Field label="Driver">
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            <div>
              <p className="section-title mb-1.5">What to bring</p>
              <ul className="mb-2 space-y-1">
                {bring.map((w, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-surface-sunken/50 px-2 py-1 text-sm text-ink-700">
                    <span className="flex-1">{w.item}{w.memberId ? ` — ${nameOf(w.memberId)}` : ""}</span>
                    <button onClick={() => setBring((b) => b.filter((_, j) => j !== i))} aria-label={`Remove ${w.item}`} className="text-ink-400 hover:text-coral-600"><Icon name="X" size={13} /></button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <TextInput value={bringItem} placeholder="Water bottle" onChange={(e) => setBringItem(e.target.value)} className="flex-1" />
                <Select value={bringWho} onChange={(e) => setBringWho(e.target.value)} className="w-36">
                  <option value="">Anyone</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
                <Button size="sm" variant="secondary" disabled={!bringItem.trim()} onClick={() => { setBring((b) => [...b, { item: bringItem.trim(), memberId: bringWho || null }]); setBringItem(""); setBringWho(""); }}><Icon name="Plus" size={13} /></Button>
              </div>
            </div>
            <div>
              <p className="section-title mb-1.5">Checklist</p>
              <ul className="mb-2 space-y-1">
                {checklist.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-surface-sunken/50 px-2 py-1 text-sm">
                    <button onClick={() => setChecklist((l) => l.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} aria-label={`Toggle ${c.text}`}>
                      <Icon name={c.done ? "CheckCircle2" : "Circle"} size={15} className={c.done ? "text-sage-500" : "text-ink-300"} />
                    </button>
                    <span className={`flex-1 ${c.done ? "text-ink-400 line-through" : "text-ink-700"}`}>{c.text}</span>
                    <button onClick={() => setChecklist((l) => l.filter((_, j) => j !== i))} aria-label={`Remove ${c.text}`} className="text-ink-400 hover:text-coral-600"><Icon name="X" size={13} /></button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <TextInput value={checkText} placeholder="Pack snacks" onChange={(e) => setCheckText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && checkText.trim()) { setChecklist((l) => [...l, { text: checkText.trim(), done: false }]); setCheckText(""); } }} className="flex-1" />
                <Button size="sm" variant="secondary" disabled={!checkText.trim()} onClick={() => { setChecklist((l) => [...l, { text: checkText.trim(), done: false }]); setCheckText(""); }}><Icon name="Plus" size={13} /></Button>
              </div>
            </div>
            <p className="text-[11px] text-ink-400">Changes to participants, driver, bring-list, and checklist apply when you press Save.</p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailBlock label="Participants">{(ev.participantIds ?? []).length ? ev.participantIds.map((id) => nameOf(id)).join(", ") : <span className="text-ink-400">None</span>}</DetailBlock>
              <DetailBlock label="Driver">{nameOf(ev.driverId) ?? <span className="text-ink-400">Unassigned</span>}</DetailBlock>
            </div>
            {(ev.whatToBring ?? []).length > 0 && (
              <DetailBlock label="What to bring">
                <ul className="space-y-0.5">{ev.whatToBring.map((w, i) => <li key={i}>• {w.item}{w.memberId ? ` — ${nameOf(w.memberId)}` : ""}</li>)}</ul>
              </DetailBlock>
            )}
            {(ev.checklist ?? []).length > 0 && (
              <DetailBlock label="Checklist">
                <ul className="space-y-0.5">{ev.checklist.map((c, i) => <li key={i} className="flex items-center gap-1.5"><Icon name={c.done ? "CheckCircle2" : "Circle"} size={13} className={c.done ? "text-sage-500" : "text-ink-300"} />{c.text}</li>)}</ul>
              </DetailBlock>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-900/[0.06] pt-3 text-xs text-ink-400">
          <span>Source: {ev.source || "FamiliOS"}</span>
          {!!ev.provenance?.googleEventId && <Badge color="sage"><Icon name="Check" size={10} /> In Google</Badge>}
          {ev.layer && <span>· {ev.layer} layer</span>}
        </div>
      </div>
    </Drawer>
  );
}
function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="section-title mb-1">{label}</p><div className="text-sm text-ink-700">{children}</div></div>;
}
