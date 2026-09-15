import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  PageHeader, Card, Button, IconButton, Badge, Drawer, Modal, Field, TextInput, TextArea, Select, EmptyState,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ToolCallStrip } from "@/components/ToolCallStrip";
import { MarkdownContent } from "@/lib/markdown";
import { fmtDateTime, fmtTime, isToday } from "@/lib/dates";
import { roleAtLeast } from "@/lib/roles";
import {
  backend, AUTONOMY_TEXT,
  type PublicHelper, type HelperAutonomy, type HelperInput, type HelperRunResult,
  type HelperSchedule, type HelperTemplate, type HelperTemplateSection, type HelperVisibility,
  type ServerConversationMessage,
} from "@/connectors/api";

/**
 * Helpers — the whole agent surface, on one screen.
 *
 * The old version spread one idea across seven: an agent here, its skill there, its
 * trigger in a third tab, its approval policy in a fourth. Nobody — including the person
 * who built it — could answer "what happens when this runs?" without opening all of them.
 *
 * So every answer a family needs lives on the card: what it is, WHEN it runs, what it may
 * do without asking, and what it did last time. Editing is one form. `scheduleText` and
 * `autonomyText` arrive already written by the server (on the household's clock, and
 * reflecting the policy that will ACTUALLY apply) — nothing here re-derives them, because
 * a second phrasing is a second chance to say something untrue.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AUTONOMY_ORDER: HelperAutonomy[] = ["ask", "act", "full"];
const AUTONOMY_LABEL: Record<HelperAutonomy, string> = {
  ask: "Ask me first",
  act: "Handle the everyday things",
  full: "Handle everything",
};

const INSTRUCTIONS_PLACEHOLDER = `Write it the way you'd explain the job to a person who is standing in for you.

For example:
Every morning, look at today's calendar for everyone in the house, the unread school email, and anything due today. Write me one short summary: who needs to be where, what I have to sign or pay, and anything that changed since yesterday. If something needs a reply, draft it and ask me before sending.`;

/* ------------------------------ plain-language bits ------------------------------ */

/** "Ran 7:02 AM — Did 3 things", the wait, or the failure in the words the server used. */
function LastRunLine({ helper }: { helper: PublicHelper }) {
  const lr = helper.lastRun;
  if (!lr) {
    return <span className="flex items-center gap-1.5 text-xs text-ink-400"><Icon name="Clock" size={12} /> Hasn't run yet</span>;
  }
  const at = new Date(lr.at).toISOString();
  const when = isToday(at) ? fmtTime(at) : fmtDateTime(at);
  if (!lr.ok) {
    return (
      <span className="flex items-start gap-1.5 text-xs text-coral-700">
        <Icon name="TriangleAlert" size={12} className="mt-0.5 shrink-0" />
        <span>Tried {when} — {lr.summary}</span>
      </span>
    );
  }
  // The server already phrases a parked run as "Waiting for approval on N things"; it
  // isn't a finished result, so it doesn't get the "Ran …" past tense.
  if (/^waiting for approval/i.test(lr.summary)) {
    return (
      <span className="flex items-start gap-1.5 text-xs text-amber-700">
        <Icon name="ShieldAlert" size={12} className="mt-0.5 shrink-0" />
        <span>{lr.summary}</span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-1.5 text-xs text-ink-500">
      <Icon name="History" size={12} className="mt-0.5 shrink-0" />
      <span>Ran {when} — {lr.summary}</span>
    </span>
  );
}

/** Every 403 the helper routes can return already carries household-facing copy. Show it
 *  verbatim; inventing a second sentence for a refusal is how UIs start lying about why. */
function refusal(r: { error?: string; message?: string }): string {
  if (r.message) return r.message;
  if (r.error === "backend_unreachable") return "Couldn't reach the server — nothing was saved.";
  if (r.error === "authentication_required") return "Sign in to make this change.";
  return "The server refused it — nothing was saved.";
}

/* ---------------------------------- the screen ---------------------------------- */

export function Helpers() {
  const helpers = useStore((s) => s.helpers);
  const refreshHelpers = useStore((s) => s.refreshHelpers);
  const role = useStore((s) => s.currentRole());
  const params = useStore((s) => s.route.params);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  // Helpers live entirely on the server — they run there, on a schedule, with no browser
  // open. So an empty list while the server is unreachable means "we can't see them",
  // not "you have none", and saying the second would be a lie the user could act on.
  const degraded = useStore((s) => s.isDegraded());

  const mayEdit = roleAtLeast(role, "Adult Member");
  // Only an Adult Admin may build for the whole household; an Adult Member's helper is
  // their own (the server enforces this and silently rewrites `visibility`), so offering
  // the choice to someone who doesn't have it would be a control that does nothing.
  const mayChooseAudience = roleAtLeast(role, "Adult Admin");

  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{ helper: PublicHelper | null; draft: Draft } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PublicHelper | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => { await refreshHelpers(); setLoading(false); }, [refreshHelpers]);
  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (params?.id) setOpenId(params.id);
    if (params?.new) setPicking(true);
  }, [params?.id, params?.new]);

  const open = helpers.find((h) => h.id === openId) ?? null;

  const startFromTemplate = (t: HelperTemplate | null) => {
    setPicking(false);
    setEditing({ helper: null, draft: t ? draftFromTemplate(t) : blankDraft() });
  };

  const togglePause = async (h: PublicHelper) => {
    setBusyId(h.id);
    const paused = h.status === "Paused";
    const r = await backend.updateHelper(h.id, { status: paused ? "Active" : "Paused", enabled: paused });
    setBusyId(null);
    if (!r.helper) { toast({ kind: "error", title: `Couldn't ${paused ? "resume" : "pause"} ${h.name}`, message: refusal(r) }); return; }
    await reload();
  };

  const remove = async (h: PublicHelper) => {
    setBusyId(h.id);
    const r = await backend.deleteHelper(h.id);
    setBusyId(null);
    setConfirmDelete(null);
    if (!r.ok) { toast({ kind: "error", title: `Couldn't delete ${h.name}`, message: refusal(r) }); return; }
    if (openId === h.id) setOpenId(null);
    toast({ kind: "success", title: `${h.name} deleted`, message: "Its past runs stay in the activity log." });
    await reload();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Helpers"
        subtitle="Each one has a job, a time it runs, and one setting for what it may do on its own."
        icon="Bot"
        actions={mayEdit ? <Button variant="ember" onClick={() => setPicking(true)}><Icon name="Plus" size={16} /> New helper</Button> : undefined}
      />

      {loading && helpers.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={15} className="animate-spin" /> Loading your helpers…</div>
      ) : helpers.length === 0 && degraded ? (
        <EmptyState
          icon="CloudOff"
          title="Can't reach your helpers right now"
          message="They live on the server and keep running on their schedules there — this list just can't see them until the connection is back."
        />
      ) : helpers.length === 0 ? (
        <EmptyState
          icon="Bot"
          title="No helpers yet"
          message="A helper is a standing instruction — what to do, and when. Start from one of the ready-made ones and edit it, or write your own."
          action={mayEdit ? <Button variant="ember" onClick={() => setPicking(true)}><Icon name="Plus" size={15} /> New helper</Button> : undefined}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {helpers.map((h) => (
            <HelperCard
              key={h.id}
              helper={h}
              mayEdit={mayEdit}
              busy={busyId === h.id}
              onOpen={() => { setAutoRun(false); setOpenId(h.id); }}
              onRun={() => { setAutoRun(true); setOpenId(h.id); }}
              onEdit={() => setEditing({ helper: h, draft: draftFromHelper(h) })}
              onTogglePause={() => void togglePause(h)}
              onDelete={() => setConfirmDelete(h)}
            />
          ))}
        </div>
      )}

      {open && (
        <HelperDrawer
          helper={open}
          mayEdit={mayEdit}
          autoRun={autoRun}
          onRanOnce={() => setAutoRun(false)}
          onChanged={reload}
          onEdit={() => setEditing({ helper: open, draft: draftFromHelper(open) })}
          onDelete={() => setConfirmDelete(open)}
          onClose={() => { setOpenId(null); setAutoRun(false); navigate("helpers"); }}
        />
      )}

      {picking && <TemplatePicker onPick={startFromTemplate} onClose={() => setPicking(false)} />}

      {editing && (
        <HelperEditor
          helper={editing.helper}
          initial={editing.draft}
          mayChooseAudience={mayChooseAudience}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => { setEditing(null); await reload(); setAutoRun(false); setOpenId(saved.id); }}
        />
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete this helper?"
        icon="Trash2"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" disabled={busyId === confirmDelete?.id} onClick={() => { if (confirmDelete) void remove(confirmDelete); }}>
              <Icon name="Trash2" size={15} /> Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          <strong>{confirmDelete?.name}</strong> stops running and its instructions are gone. What it already did stays in the activity log. This can't be undone.
        </p>
      </Modal>
    </div>
  );
}

/* ----------------------------------- the card ----------------------------------- */

function HelperCard({ helper, mayEdit, busy, onOpen, onRun, onEdit, onTogglePause, onDelete }: {
  helper: PublicHelper;
  mayEdit: boolean;
  busy: boolean;
  onOpen: () => void;
  onRun: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const paused = helper.status === "Paused";
  return (
    <Card className="card-pad flex flex-col" hover>
      <div className="flex items-start gap-3" onClick={onOpen} role="button">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(23,27,38,0.20)] ${paused ? "bg-ink-400" : "bg-gradient-to-br from-ink-700 to-ink-900"}`}>
          <Icon name={helper.icon || "Bot"} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-lg font-semibold text-ink-900">{helper.name}</p>
          {helper.purpose && <p className="line-clamp-2 text-xs text-ink-500">{helper.purpose}</p>}
        </div>
        {paused && <Badge color="amber"><Icon name="Pause" size={11} /> Paused</Badge>}
        {helper.visibility === "personal" && <Badge color="sky"><Icon name="Lock" size={11} /> Just me</Badge>}
      </div>

      <div className="mt-3 space-y-1.5 border-t border-ink-900/[0.06] pt-3">
        <p className="flex items-start gap-1.5 text-xs text-ink-600">
          <Icon name="CalendarClock" size={12} className="mt-0.5 shrink-0 text-ink-400" />
          {paused ? "Paused — it won't run on its own" : helper.scheduleText}
        </p>
        <p className="flex items-start gap-1.5 text-xs text-ink-600">
          <Icon name="ShieldCheck" size={12} className="mt-0.5 shrink-0 text-ink-400" />
          {helper.autonomyText}
        </p>
        <LastRunLine helper={helper} />
        {helper.autonomyDowngraded && <DowngradeNote />}
      </div>

      <div className="mt-3 flex items-center gap-1 border-t border-ink-900/[0.06] pt-3">
        {mayEdit && (
          <Button size="sm" variant="secondary" disabled={busy || paused} onClick={onRun} title={paused ? "Resume it first" : "Run it now"}>
            <Icon name="Play" size={14} /> Run now
          </Button>
        )}
        {mayEdit && <IconButton icon="Pencil" label={`Edit ${helper.name}`} onClick={onEdit} />}
        {mayEdit && (
          paused
            ? <IconButton icon="Play" label={`Resume ${helper.name}`} onClick={onTogglePause} />
            : <IconButton icon="Pause" label={`Pause ${helper.name}`} onClick={onTogglePause} />
        )}
        {mayEdit && <IconButton icon="Trash2" label={`Delete ${helper.name}`} onClick={onDelete} />}
        <IconButton icon="ChevronRight" label={`Open ${helper.name}`} className="ml-auto" onClick={onOpen} />
      </div>
    </Card>
  );
}

function DowngradeNote() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-ink-400">
      <Icon name="Info" size={12} className="mt-0.5 shrink-0" />
      The top setting needs an Owner or Adult Admin, so this one still asks before sending or spending.
    </p>
  );
}

/* ---------------------------------- the drawer ---------------------------------- */

function HelperDrawer({ helper, mayEdit, autoRun, onRanOnce, onChanged, onEdit, onDelete, onClose }: {
  helper: PublicHelper;
  mayEdit: boolean;
  autoRun: boolean;
  onRanOnce: () => void;
  onChanged: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const [history, setHistory] = useState<ServerConversationMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HelperRunResult | null>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    const h = await backend.helperHistory(helper.id);
    setHistory(h.messages);
    setLoadingHistory(false);
  }, [helper.id]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    // No stream: the run is one POST that can sit for 30s+ while the engine works through
    // real tools. The spinner is the whole progress story, so it says what's happening
    // rather than pretending to be a progress bar that knows how far along it is.
    const r = await backend.runHelper(helper.id);
    setRunning(false);
    setResult(r);
    if (!r.ok) toast({ kind: "error", title: `${helper.name} couldn't finish`, message: refusal(r) });
    await loadHistory();
    await onChanged();
  }, [helper.id, helper.name, loadHistory, onChanged, toast]);

  // "Run now" from a card opens this drawer already running, so the answer lands where
  // the rest of the helper's history is instead of in a toast that scrolls away.
  useEffect(() => {
    if (!autoRun) return;
    onRanOnce();
    void run();
  }, [autoRun, onRanOnce, run]);

  const paused = helper.status === "Paused";
  return (
    <Drawer
      open
      onClose={onClose}
      title={helper.name}
      icon={helper.icon || "Bot"}
      width="max-w-2xl"
      footer={mayEdit ? (
        <>
          <Button variant="ghost" onClick={onDelete}><Icon name="Trash2" size={15} /> Delete</Button>
          <Button variant="secondary" onClick={onEdit}><Icon name="Pencil" size={15} /> Edit</Button>
          <Button variant="ember" disabled={running || paused} onClick={() => void run()}>
            {running ? <><Icon name="Loader2" size={15} className="animate-spin" /> Running…</> : <><Icon name="Play" size={15} /> Run now</>}
          </Button>
        </>
      ) : undefined}
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          {helper.purpose && <p className="text-sm text-ink-600">{helper.purpose}</p>}
          <p className="flex items-center gap-1.5 text-sm text-ink-600"><Icon name="CalendarClock" size={14} className="text-ink-400" /> {paused ? "Paused — it won't run on its own" : helper.scheduleText}</p>
          <p className="flex items-center gap-1.5 text-sm text-ink-600"><Icon name="ShieldCheck" size={14} className="text-ink-400" /> {helper.autonomyText}</p>
          {helper.autonomyDowngraded && <DowngradeNote />}
        </div>

        <section>
          <p className="section-title mb-2">What it does</p>
          <div className="whitespace-pre-wrap rounded-2xl border border-ink-900/[0.06] bg-surface-sunken/50 p-3 text-sm text-ink-700">{helper.instructions}</div>
        </section>

        {(running || result) && (
          <section>
            <p className="section-title mb-2">This run</p>
            {running ? (
              <Card className="card-pad flex items-center gap-2.5 text-sm text-ink-500">
                <Icon name="Loader2" size={16} className="animate-spin text-ember-500" />
                Working — it's reading, deciding, and using tools. This can take a while.
              </Card>
            ) : result?.ok ? (
              <Card className="card-pad space-y-2.5">
                <MarkdownContent text={result.answer ?? ""} />
                <ToolCallStrip calls={result.toolCalls} />
              </Card>
            ) : (
              <Card className="card-pad text-sm text-coral-700">{result ? refusal(result) : null}</Card>
            )}
          </section>
        )}

        <section>
          <p className="section-title mb-2">History</p>
          {loadingHistory ? (
            <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading…</div>
          ) : history.length === 0 ? (
            <p className="text-sm text-ink-400">Nothing yet. Run it once and what it did shows up here.</p>
          ) : (
            <div className="space-y-3">
              {[...history].reverse().map((m, i) => <HistoryRow key={`${m.at}-${i}`} message={m} />)}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}

/** A helper's history IS its chat thread, so it renders as one — the same bubble for the
 *  ask, the same answer + receipts for what came back. */
function HistoryRow({ message }: { message: ServerConversationMessage }) {
  const toolCalls = message.toolCalls ?? undefined;
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-b from-ink-700 to-ink-900 px-3.5 py-2.5 text-sm text-white shadow-e1">{message.text}</div>
      </div>
    );
  }
  const failed = message.kind === "error";
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ember-400 to-ember-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"><Icon name="Sparkles" size={15} /></div>
      <div className="min-w-0 flex-1 space-y-2">
        {failed ? <p className="text-sm text-coral-700">{message.text}</p> : <MarkdownContent text={message.text} />}
        <ToolCallStrip calls={toolCalls} />
        <p className="text-[11px] text-ink-400">{fmtDateTime(message.at)}</p>
      </div>
    </div>
  );
}

/* --------------------------------- the picker ---------------------------------- */

function TemplatePicker({ onPick, onClose }: { onPick: (t: HelperTemplate | null) => void; onClose: () => void }) {
  const [sections, setSections] = useState<HelperTemplateSection[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void backend.helperTemplates().then((s) => { if (alive) { setSections(s); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  return (
    <Modal open onClose={onClose} title="New helper" icon="Plus" size="xl">
      <p className="mb-4 text-sm text-ink-500">
        Pick something close to what you want. You'll read and edit its actual instructions before it's saved — nothing runs until you've seen exactly what it was told to do.
      </p>

      <button
        onClick={() => onPick(null)}
        className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-dashed border-ink-900/15 bg-surface-sunken/50 px-4 py-3 text-left transition-colors hover:border-ember-300 hover:bg-surface-overlay"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-ink-600 shadow-e1"><Icon name="PenLine" size={18} /></span>
        <span>
          <span className="block text-sm font-semibold text-ink-800">Start from scratch</span>
          <span className="block text-xs text-ink-500">Write the job yourself, in your own words.</span>
        </span>
      </button>

      {loading && <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading ready-made helpers…</div>}
      {!loading && sections.length === 0 && (
        <p className="text-sm text-ink-400">No ready-made helpers are available right now — "Start from scratch" above still works.</p>
      )}

      <div className="space-y-5">
        {sections.map((section) => (
          <div key={section.key}>
            <p className="section-title mb-2">{section.title}</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {section.templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onPick(t)}
                  className="flex items-start gap-3 rounded-2xl border border-ink-900/[0.08] bg-surface-raised p-3 text-left shadow-e1 transition-colors hover:border-ember-300"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-900 text-white"><Icon name={t.icon || "Bot"} size={18} /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink-800">{t.name}</span>
                    <span className="block text-xs text-ink-500">{t.purpose}</span>
                    <span className="mt-1 block text-[11px] text-ink-400">{t.scheduleText} · {t.autonomyText}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* --------------------------------- the editor ---------------------------------- */

interface Draft {
  name: string;
  purpose: string;
  instructions: string;
  icon: string;
  scheduleKind: HelperSchedule["kind"];
  time: string;
  weekday: number;
  autonomy: HelperAutonomy;
  visibility: Exclude<HelperVisibility, "nest">;
}

function blankDraft(): Draft {
  return { name: "", purpose: "", instructions: "", icon: "Bot", scheduleKind: "manual", time: "07:00", weekday: 1, autonomy: "ask", visibility: "household" };
}
function draftFromTemplate(t: HelperTemplate): Draft {
  const s = t.schedule;
  return {
    name: t.name,
    purpose: t.purpose,
    instructions: t.instructions,
    icon: t.icon || "Bot",
    scheduleKind: s.kind,
    time: "time" in s ? s.time : "07:00",
    weekday: s.kind === "weekly" ? s.weekday : 1,
    autonomy: t.autonomy,
    visibility: "household",
  };
}
function draftFromHelper(h: PublicHelper): Draft {
  const s = h.schedule;
  return {
    name: h.name,
    purpose: h.purpose,
    instructions: h.instructions,
    icon: h.icon || "Bot",
    scheduleKind: s.kind,
    time: "time" in s ? s.time : "07:00",
    weekday: s.kind === "weekly" ? s.weekday : 1,
    autonomy: h.autonomy,
    visibility: h.visibility === "personal" ? "personal" : "household",
  };
}

function scheduleFrom(d: Draft): HelperSchedule {
  if (d.scheduleKind === "manual") return { kind: "manual" };
  if (d.scheduleKind === "hourly") return { kind: "hourly" };
  if (d.scheduleKind === "weekly") return { kind: "weekly", time: d.time, weekday: d.weekday };
  return { kind: "daily", time: d.time };
}

function HelperEditor({ helper, initial, mayChooseAudience: mayChooseAudienceProp, onClose, onSaved }: {
  helper: PublicHelper | null;
  initial: Draft;
  mayChooseAudience: boolean;
  onClose: () => void;
  onSaved: (saved: PublicHelper) => void | Promise<void>;
}) {
  const toast = useStore((s) => s.toast);
  // A NEST helper belongs to that nest and nobody else — not the Owner, not an Adult
  // Admin. This form has no nest picker, so the audience control is hidden for one and
  // `visibility` is left out of the body entirely: sending "household" here would quietly
  // re-scope somebody's nest helper to the whole house on an edit about something else.
  const isNestScoped = helper?.visibility === "nest";
  const mayChooseAudience = mayChooseAudienceProp && !isNestScoped;
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [pinNeeded, setPinNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const valid = d.name.trim().length > 0 && d.instructions.trim().length > 0;
  // Only the top tier is PIN-gated, and only when it's actually being turned ON. Making
  // someone prove themselves in order to become MORE careful teaches them to leave it on.
  const raisingToFull = d.autonomy === "full" && helper?.autonomy !== "full";

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const body: HelperInput = {
      name: d.name.trim(),
      purpose: d.purpose.trim(),
      instructions: d.instructions.trim(),
      icon: d.icon,
      schedule: scheduleFrom(d),
      autonomy: d.autonomy,
      ...(mayChooseAudience ? { visibility: d.visibility } : {}),
      ...(raisingToFull && pin ? { pin } : {}),
    };
    const r = helper ? await backend.updateHelper(helper.id, body) : await backend.createHelper(body);
    setBusy(false);
    if (r.helper) {
      setPin("");
      toast({ kind: "success", title: helper ? `${r.helper.name} updated` : `${r.helper.name} created`, message: r.helper.scheduleText });
      await onSaved(r.helper);
      return;
    }
    if (r.error === "pin_required" || r.error === "pin_invalid") {
      setPinNeeded(true);
      setError(refusal(r));
      return;
    }
    setError(refusal(r));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={helper ? `Edit ${helper.name}` : "New helper"}
      icon={d.icon || "Bot"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="ember" disabled={!valid || busy || (pinNeeded && !pin.trim())} onClick={() => void save()}>
            {busy ? <><Icon name="Loader2" size={15} className="animate-spin" /> Saving…</> : <><Icon name="Check" size={15} /> {helper ? "Save changes" : "Create helper"}</>}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={d.name} autoFocus onChange={(e) => set("name", e.target.value)} placeholder="Morning Briefing" />
        </Field>

        <Field label="One line about it" hint="Optional — what you'd tell someone it's for.">
          <TextInput value={d.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="One short summary of the day, every morning." />
        </Field>

        {/* The important field. It isn't a description of a hidden step graph — it IS what
            the helper gets told, word for word, so it gets the room that deserves. */}
        <Field label="What it does" hint="Plain English. This is exactly what the helper is told, so say what 'done' looks like and what it should check with you first.">
          <TextArea value={d.instructions} onChange={(e) => set("instructions", e.target.value)} rows={12} className="min-h-[240px] font-normal" placeholder={INSTRUCTIONS_PLACEHOLDER} />
        </Field>

        <div className="rounded-2xl border border-ink-900/[0.08] bg-surface-rim p-3">
          <p className="mb-2 text-sm font-semibold text-ink-700">When it runs</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="How often">
              <Select value={d.scheduleKind} onChange={(e) => set("scheduleKind", e.target.value as Draft["scheduleKind"])}>
                <option value="manual">Only when I ask</option>
                <option value="hourly">Every hour</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </Select>
            </Field>
            {(d.scheduleKind === "daily" || d.scheduleKind === "weekly") && (
              <Field label="At">
                <TextInput type="time" value={d.time} onChange={(e) => set("time", e.target.value || "07:00")} />
              </Field>
            )}
            {d.scheduleKind === "weekly" && (
              <Field label="On">
                <Select value={String(d.weekday)} onChange={(e) => set("weekday", Number(e.target.value))}>
                  {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
                </Select>
              </Field>
            )}
          </div>
          {(d.scheduleKind === "daily" || d.scheduleKind === "weekly") && (
            <p className="mt-1 text-xs text-ink-400">Your household's clock, not the server's.</p>
          )}
        </div>

        <div className="rounded-2xl border border-ink-900/[0.08] bg-surface-rim p-3">
          <p className="mb-2 text-sm font-semibold text-ink-700">What it may do on its own</p>
          <div className="space-y-2">
            {AUTONOMY_ORDER.map((a) => (
              <label key={a} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-colors ${d.autonomy === a ? "border-ember-300 bg-ember-50/60" : "border-ink-900/[0.06] bg-surface-raised hover:border-ink-900/15"}`}>
                <input
                  type="radio"
                  name="autonomy"
                  className="mt-0.5 accent-ember-500"
                  checked={d.autonomy === a}
                  onChange={() => set("autonomy", a)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-800">{AUTONOMY_LABEL[a]}</span>
                  <span className="block text-xs text-ink-500">{AUTONOMY_TEXT[a]}</span>
                </span>
              </label>
            ))}
          </div>
          {raisingToFull && (
            <Field className="mt-3" label="Household PIN" hint="The top setting is the only one that can send and spend with nobody watching, so it asks for the PIN once.">
              <TextInput type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" autoComplete="off" />
            </Field>
          )}
        </div>

        {isNestScoped && (
          <p className="flex items-start gap-1.5 text-xs text-ink-400">
            <Icon name="Users" size={12} className="mt-0.5 shrink-0" />
            This one belongs to a nest, so it stays there. Who it's for is changed from the nest itself.
          </p>
        )}

        {mayChooseAudience && (
          <Field label="Who it's for" hint="A household helper is visible to every adult here. A personal one is yours alone.">
            <Select value={d.visibility} onChange={(e) => set("visibility", e.target.value as Draft["visibility"])}>
              <option value="household">Everyone in the household</option>
              <option value="personal">Just me</option>
            </Select>
          </Field>
        )}

        {error && <p className="flex items-start gap-1.5 text-sm text-coral-700"><Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" /> {error}</p>}
      </div>
    </Modal>
  );
}
