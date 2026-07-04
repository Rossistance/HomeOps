import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, Badge, Drawer, Field, TextInput, Select } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { backend, type ServerEvent, type BackendApproval } from "@/connectors/api";

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const toLocalInput = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(+d)) return ""; const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** Calendar — the home for the rich family-event model (P4.1) and the three-layer
 *  calendar (P4.2): HomeOps-owned "canonical" events are editable + pushable to Google;
 *  "linked" events (Google/ICS subscriptions) are read-only (copy to edit).
 *  Phase 3 polish: list ⇄ month grid toggle, editable participants/driver/what-to-bring/
 *  checklist in the drawer, and one-step inline approval for Google push. */
export function Calendar() {
  const toast = useStore((s) => s.toast);
  const role = useStore((s) => s.session?.role);
  const members = useStore((s) => s.data.members);
  const canManage = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(role ?? "");
  const nameOf = (id?: string | null) => (id ? members.find((m) => m.id === id)?.displayName ?? id : null);

  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [selected, setSelected] = useState<ServerEvent | null>(null);
  const [view, setView] = useState<"list" | "month">("list");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(toLocalInput(new Date().toISOString()));
  const [location, setLocation] = useState("");

  const load = async () => setEvents(await backend.events());
  useEffect(() => { void load(); }, []);

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
      <PageHeader title="Calendar" subtitle="Your household's events. HomeOps events are yours to edit and push to Google; synced feeds are read-only." icon="CalendarDays" />

      <div className="mb-4 inline-flex rounded-xl border border-ink-900/[0.08] bg-surface-sunken/60 p-0.5" role="tablist" aria-label="Calendar view">
        {(["list", "month"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`rounded-[10px] px-3.5 py-1.5 text-sm font-semibold capitalize transition-colors ${view === v ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"}`}>
            <Icon name={v === "list" ? "List" : "LayoutGrid"} size={13} className="mr-1 inline" />{v}
          </button>
        ))}
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
        <MonthGrid byDay={byDayAll} nameOf={nameOf} onOpen={setSelected} />
      ) : upcoming.length === 0 ? (
        <Card className="card-pad"><p className="text-sm text-ink-400">Nothing on the calendar yet. Add an event, subscribe to a calendar in Connections, or connect Google.</p></Card>
      ) : (
        <div className="space-y-3">
          {days.map((k) => (
            <Card key={k} className="card-pad">
              <p className="mb-2 font-display text-sm font-semibold text-ink-900">{new Date(k + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}{k === new Date().toISOString().slice(0, 10) && <span className="ml-2 text-xs font-normal text-ember-600">Today</span>}</p>
              <ul className="space-y-1.5">{byDay[k].map((e) => <EventRow key={e.id} ev={e} driver={nameOf(e.driverId)} onOpen={() => setSelected(e)} />)}</ul>
            </Card>
          ))}
          {byDay["undated"] && <Card className="card-pad"><p className="mb-2 font-display text-sm font-semibold text-ink-900">No date set</p><ul className="space-y-1.5">{byDay["undated"].map((e) => <EventRow key={e.id} ev={e} driver={nameOf(e.driverId)} onOpen={() => setSelected(e)} />)}</ul></Card>}
        </div>
      )}

      {selected && <EventDrawer ev={selected} canManage={canManage} members={members.map((m) => ({ id: m.id, name: m.displayName }))} nameOf={nameOf} onClose={() => setSelected(null)} onChanged={refreshSelected} onGone={async () => { setSelected(null); await load(); }} />}
    </div>
  );
}

/* ---- Month grid (Phase 3): a 7-column month with per-day event chips ---- */
function MonthGrid({ byDay, nameOf, onOpen }: { byDay: Record<string, ServerEvent[]>; nameOf: (id?: string | null) => string | null; onOpen: (e: ServerEvent) => void }) {
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
                  <span key={e.id} title={e.title} className={`h-1.5 w-1.5 rounded-full ${e.layer === "linked" ? "bg-sky-400" : e.layer === "public" ? "bg-ink-300" : "bg-ember-500"}`} />
                ))}
                {(byDay[k]?.length ?? 0) > 3 && <span className="text-[10px] leading-none text-ink-400">+{(byDay[k]?.length ?? 0) - 3}</span>}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-400"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-ember-500 align-middle" /> HomeOps <span className="mx-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400 align-middle" /> Synced</p>
      </Card>
      {selDay && (
        <Card className="card-pad">
          <p className="mb-2 font-display text-sm font-semibold text-ink-900">{new Date(selDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
          {(byDay[selDay] ?? []).length === 0
            ? <p className="text-sm text-ink-400">Nothing scheduled this day.</p>
            : <ul className="space-y-1.5">{(byDay[selDay] ?? []).map((e) => <EventRow key={e.id} ev={e} driver={nameOf(e.driverId)} onOpen={() => onOpen(e)} />)}</ul>}
        </Card>
      )}
    </div>
  );
}

function layerBadge(ev: ServerEvent) {
  if (ev.layer === "linked") return <Badge color="sky"><Icon name="RefreshCw" size={10} /> Synced</Badge>;
  if (ev.layer === "public") return <Badge color="gray">Public</Badge>;
  return null;
}
function EventRow({ ev, driver, onOpen }: { ev: ServerEvent; driver: string | null; onOpen: () => void }) {
  const time = ev.startAt && !isNaN(+new Date(ev.startAt)) ? new Date(ev.startAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-start gap-2.5 rounded-xl border border-ink-900/[0.05] bg-surface-sunken/50 px-3 py-2 text-left transition-colors hover:border-ember-200" aria-label={`Open ${ev.title}`}>
        <Icon name="Calendar" size={14} className="mt-0.5 shrink-0 text-ink-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-800">{ev.title} {layerBadge(ev)}</p>
          <p className="truncate text-xs text-ink-500">{time ?? "All day"}{ev.location ? ` · ${ev.location}` : ""}{driver ? ` · Driver: ${driver}` : ""}{ev.source && ev.layer === "linked" ? ` · ${ev.source}` : ""}</p>
        </div>
        <Icon name="ChevronRight" size={15} className="shrink-0 text-ink-300" />
      </button>
    </li>
  );
}

function EventDrawer({ ev, canManage, members, nameOf, onClose, onChanged, onGone }: { ev: ServerEvent; canManage: boolean; members: { id: string; name: string }[]; nameOf: (id?: string | null) => string | null; onClose: () => void; onChanged: (id: string) => Promise<void>; onGone: () => Promise<void> }) {
  const toast = useStore((s) => s.toast);
  const linked = ev.layer === "linked" || ev.layer === "public";
  const [title, setTitle] = useState(ev.title);
  const [location, setLocation] = useState(ev.location ?? "");
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
      title, location, startAt: start ? new Date(start).toISOString() : null,
      participantIds, driverId: driverId || null, whatToBring: bring, checklist,
    });
    setBusy(false);
    if (r.event) { await onChanged(ev.id); toast({ kind: "success", title: "Saved" }); }
    else toast({ kind: "error", title: "Couldn't save", message: r.error });
  };
  const del = async () => { setBusy(true); await backend.deleteEvent(ev.id); setBusy(false); await onGone(); toast({ kind: "info", title: "Event removed" }); };
  const copy = async () => { setBusy(true); const r = await backend.createEvent({ title: ev.title, startAt: ev.startAt, endAt: ev.endAt, location: ev.location, participantIds: ev.participantIds, visibility: "household" }); setBusy(false); if (r.event) { await onGone(); toast({ kind: "success", title: "Copied to a HomeOps event", message: "Now editable." }); } };

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

  return (
    <Drawer open onClose={onClose} icon="Calendar" title={ev.title}
      footer={canManage && !linked ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={save}><Icon name="Save" size={14} /> Save</Button>
          <Button variant="secondary" disabled={busy || !!pushApproval} onClick={() => push()}><Icon name="Upload" size={14} /> {ev.provenance?.googleEventId ? "Update in Google" : "Push to Google"}</Button>
          <Button variant="ghost" disabled={busy} onClick={del}><Icon name="Trash2" size={14} /> Delete</Button>
        </div>
      ) : canManage && linked ? <Button variant="ember" disabled={busy} onClick={copy}><Icon name="Copy" size={14} /> Copy to a HomeOps event</Button> : undefined}>
      <div className="space-y-4">
        {linked && <p className="rounded-2xl border border-sky-200/70 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-800"><Icon name="RefreshCw" size={13} className="mr-1 inline" /> Synced from {ev.source || "an external calendar"} — read-only here. Copy it to make an editable HomeOps event.</p>}

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

        {!linked && canManage ? (
          <div className="space-y-2.5">
            <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="When"><TextInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Location"><TextInput value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          </div>
        ) : (
          <div className="text-sm text-ink-600">
            <p><span className="text-ink-400">When:</span> {ev.startAt ? new Date(ev.startAt).toLocaleString() : "No date set"}</p>
            {ev.location && <p><span className="text-ink-400">Where:</span> {ev.location}</p>}
          </div>
        )}

        {/* Rich family-event model — editable for canonical events (Phase 3) */}
        {!linked && canManage ? (
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
          <span>Source: {ev.source || "HomeOps"}</span>
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
