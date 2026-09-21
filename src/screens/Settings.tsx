import { useEffect, useRef, useState } from "react";
import { useStore, type Toast } from "@/store/useStore";
import { brand } from "@/brand";
import { exportBackup, importBackup } from "@/storage/backup";
import { PageHeader, Card, SectionTitle, Button, Toggle, Select, Badge, Modal, HealthDot, Field, TextInput, Avatar } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { backend, type CatalogTool, type RiskOverride, type Autonomy, type BackendSettings, type GroupChatsView } from "@/connectors/api";
import { useCalmMode, useAdvancedMode } from "@/lib/prefs";

export function Settings() {
  const data = useStore((s) => s.data);
  const settings = data.settings;
  const storageMode = useStore((s) => s.storageMode);
  const storageError = useStore((s) => s.storageError);
  const backendOnline = useStore((s) => s.backendOnline);
  const health = useStore((s) => s.backendHealth);
  const externalActionsEnabled = useStore((s) => s.externalActionsEnabled);
  const setKillSwitch = useStore((s) => s.setKillSwitch);
  const connectors = useStore((s) => s.connectors);
  const updateSettings = useStore((s) => s.updateSettings);
  const reseed = useStore((s) => s.reseed);
  const startFresh = useStore((s) => s.startFresh);
  const importData = useStore((s) => s.importData);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const session = useStore((s) => s.session);
  const logout = useStore((s) => s.logout);
  const fileRef = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [freshOpen, setFreshOpen] = useState(false);
  const [pin, setPin] = useState("");
  const me = data.members.find((m) => m.id === session?.actorId) ?? data.members.find((m) => m.isCurrentUser);
  const [calm, setCalm] = useCalmMode();
  const [advanced, setAdvanced] = useAdvancedMode();
  const setOwnerPin = async () => { if (!pin) return; await backend.setSettings({ ownerPin: pin }); setPin(""); toast({ kind: "success", title: "Owner PIN set", message: "Elevated profiles now require this PIN to sign in." }); };
  // Calendar auto-sync (server-owned, Adult Admin): pre-authorized Google pushes + two-way sweep.
  const [calendarAutoSync, setCalendarAutoSync] = useState(false);
  const [hideProfilesPreAuth, setHideProfilesPreAuth] = useState(false);
  // Household timezone (server-owned, Adult Admin): anchors "every day at 7 AM" triggers
  // to a real wall-clock time. Unset silently falls back to the SERVER's clock — a
  // scheduled briefing can fire hours off from what the household actually meant.
  const [timezone, setTimezoneState] = useState<string | null>(null);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezoneOptions: string[] = (() => {
    // tsconfig's lib target (ES2020) predates Intl.supportedValuesOf (ES2022) — feature-detect
    // via a safe cast rather than bumping the global lib target for one call site.
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
    try { return typeof supportedValuesOf === "function" ? supportedValuesOf("timeZone") : [browserTz]; } catch { return [browserTz]; }
  })();
  useEffect(() => { void backend.getSettings().then((s) => { setCalendarAutoSync(s.calendarAutoSync === true); setTimezoneState(s.timezone ?? null); setHideProfilesPreAuth(s.hideProfilesPreAuth === true); }); }, []);
  const setTimezone = async (tz: string) => {
    setTimezoneState(tz);
    const s = await backend.setSettings({ timezone: tz });
    setTimezoneState(s.timezone ?? null);
    toast({ kind: "success", title: "Timezone set", message: `Scheduled helpers (like a 7 AM briefing) now anchor to ${tz}.` });
  };
  const toggleCalendarAutoSync = async (v: boolean) => {
    setCalendarAutoSync(v);
    const s = await backend.setSettings({ calendarAutoSync: v });
    setCalendarAutoSync(s.calendarAutoSync === true);
    toast({ kind: v ? "success" : "info", title: v ? "Calendar auto-sync on" : "Calendar auto-sync off", message: v ? "Google pushes are pre-authorized and both calendars mirror automatically." : "Google pushes ask for approval again." });
  };
  // WP-010 (ISS-015): pre-auth privacy — with this on, the sign-in screen shows no
  // family member names until someone presents this household's hint or a session.
  const toggleHideProfilesPreAuth = async (v: boolean) => {
    setHideProfilesPreAuth(v);
    const s = await backend.setSettings({ hideProfilesPreAuth: v });
    setHideProfilesPreAuth(s.hideProfilesPreAuth === true);
    toast({ kind: v ? "success" : "info", title: v ? "Sign-in screen hides your family" : "Sign-in screen shows profiles", message: v ? "Visitors on this device see no family names before signing in." : "The profile picker lists family members again." });
  };

  const onImport = async (file?: File | null) => {
    if (!file) return;
    const res = await importBackup(file);
    if (res.ok && res.data) importData(res.data);
    else toast({ kind: "error", title: "Import failed", message: res.error });
  };
  const storageLabel = storageMode === "indexeddb" ? "IndexedDB (primary)" : storageMode === "localstorage" ? "localStorage (fallback)" : "Unavailable";

  return (
    <div className="animate-fade-in max-w-3xl">
      <PageHeader title="Settings" subtitle="Runtime, connectors, privacy, and household preferences." icon="Settings" />
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />

      <div className="space-y-5">
        {/* Account / session */}
        <Card className="card-pad">
          <SectionTitle icon="UserCircle">Profile & session</SectionTitle>
          <div className="flex flex-wrap items-center gap-3">
            {me && <Avatar initials={me.initials} color={me.avatarColor} size={40} />}
            <div className="flex-1">
              <p className="text-sm font-medium text-ink-800">{session?.actorName ?? me?.displayName}</p>
              <p className="text-xs text-ink-500">Signed in · {session?.role ?? me?.role} {session?.csrf ? "" : "(local-only — backend offline)"}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => logout()}><Icon name="LogOut" size={14} /> Sign out / switch profile</Button>
          </div>
          <div className="mt-3 border-t border-sand-100 pt-3">
            <Field label="Owner PIN (protects Owner / Adult Admin sign-in)" hint="Set or change the PIN required to sign in as an elevated profile.">
              <div className="flex gap-2">
                <TextInput type="password" value={pin} placeholder="Choose a PIN" onChange={(e) => setPin(e.target.value)} />
                <Button variant="secondary" disabled={!pin} onClick={setOwnerPin}>Set PIN</Button>
              </div>
            </Field>
          </div>
        </Card>

        {/* Backend runtime */}
        <Card className="card-pad">
          <SectionTitle icon="Server">Backend runtime</SectionTitle>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <HealthDot ok={backendOnline} label={backendOnline ? "Online" : "Offline"} />
            {health && <span className="text-ink-500">v{health.version} · {health.runtime}</span>}
            <span className="text-ink-500">Browser automation: {health?.browserRuntime ? "runtime connected" : "not connected"}</span>
          </div>
          {health && <p className="mb-2 text-xs text-ink-500">Webhook base URL: <code className="rounded bg-sand-100 px-1">{health.webhookBaseUrl}</code></p>}
          {!backendOnline && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-600">The runtime is offline. Run <code className="rounded bg-sand-200 px-1">npm run dev</code> (it starts the backend + web together).</p>}
          <Row label="External actions" desc="Master kill switch — when off, the backend blocks every write/send tool.">
            <Toggle checked={externalActionsEnabled} onChange={(v) => setKillSwitch(v)} />
          </Row>
          <Row label="Calendar auto-sync" desc="Pre-authorize Google Calendar: pushes skip per-event approvals, local edits mirror to Google instantly, and the server sweeps both directions automatically. Conflicts still ask a human.">
            <Toggle checked={calendarAutoSync} onChange={(v) => void toggleCalendarAutoSync(v)} ariaLabel="Calendar auto-sync" />
          </Row>
          <Row label="Household timezone" desc={timezone ? "A helper that runs on a schedule — a 7 AM briefing, say — fires at this wall-clock time." : `Not set — scheduled helpers currently anchor to the SERVER's clock, not your household's. This browser is in ${browserTz}.`}>
            <Select value={timezone ?? ""} onChange={(e) => void setTimezone(e.target.value)} aria-label="Household timezone">
              <option value="" disabled>{timezone ? timezone : "Choose a timezone…"}</option>
              {!timezoneOptions.includes(browserTz) ? null : (
                <option value={browserTz}>{browserTz} (this browser)</option>
              )}
              {timezoneOptions.filter((tz) => tz !== browserTz).map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </Select>
          </Row>
        </Card>

        {/* Connectors */}
        <Card className="card-pad">
          <SectionTitle icon="Plug" action={<Button size="sm" variant="secondary" onClick={() => navigate("connections")}>Open Connections</Button>}>Connectors</SectionTitle>
          <p className="mb-2 text-sm text-ink-500">{connectors.length} {connectors.length === 1 ? "connector is" : "connectors are"} live. Connect Google in Connections; the rest are set up by the deployment.</p>
          <div className="flex flex-wrap gap-1.5">{connectors.map((c) => <Badge key={c.id} color="gray">{c.name}</Badge>)}</div>
        </Card>

        {/* AI PROVIDERS ARE NOT SET UP HERE ANY MORE.
            Keys arrive as deployment environment variables (GROQ_API_KEY, TOGETHER_API_KEY,
            …) and bootstrapAIFromEnv claims the active and triage tiers on first boot, so
            the panel was a second way to configure something already configured — and the
            more dangerous way, since a household could point a tier at a model their
            deployment has no key for and get a provider that reads "healthy" and fails on
            every call. The panel itself still exists (screens/AIProviders.tsx) for whoever
            needs it back; it is the ROUTE into it that is gone. */}

        {/* Privacy */}
        <Card className="card-pad">
          <SectionTitle icon="Lock">Privacy</SectionTitle>
          {/* The two privacy toggles that used to sit here were read by nothing: memory scope is
              enforced server-side per room, and external-action approval is the autonomy stance
              below. A switch that changes nothing is worse than no switch. */}
          <Row label="Hide family names on the sign-in screen" desc="Until someone signs in, this device's profile picker shows no names (ISS-015 privacy flag; enforced server-side)."><Toggle checked={hideProfilesPreAuth} onChange={(v) => void toggleHideProfilesPreAuth(v)} ariaLabel="Hide family names on the sign-in screen" /></Row>
        </Card>

        <GroupChatsCard toast={toast} />

        {/* Appearance & solo mode */}
        <Card className="card-pad">
          <SectionTitle icon="Palette">Appearance & branding</SectionTitle>
          <p className="mt-2 rounded-lg bg-sand-50 px-3 py-2 text-sm text-ink-500">Rename the whole product in <code className="rounded bg-sand-200 px-1">src/brand.ts</code> — currently “{brand.name}”.</p>
        </Card>

        {/* Comfort & accessibility — inclusive, neurodivergent-friendly controls */}
        <Card className="card-pad">
          <SectionTitle icon="Waves">Comfort & accessibility</SectionTitle>
          <Row label="Calm Mode" desc="Stills motion, flattens depth, and softens color for a quieter, lower-stimulation interface.">
            <Toggle checked={calm} onChange={(v) => setCalm(v)} ariaLabel="Calm Mode" />
          </Row>
          <p className="mt-2 rounded-xl bg-surface-sunken/60 px-3 py-2 text-sm text-ink-500">
            Motion also follows your device's “reduce motion” setting automatically. Calm Mode goes further — turning off the ambient hearth glow and the lift-on-touch depth across every screen.
          </p>
        </Card>

        {/* Advanced */}
        <Card className="card-pad">
          <SectionTitle icon="FlaskConical">Advanced</SectionTitle>
          <Row label="Advanced Mode" desc="Show the full activity log — every low-level thing your helpers and the runtime did, in the runtime’s own words. Most households never need it.">
            <Toggle checked={advanced} onChange={(v) => setAdvanced(v)} ariaLabel="Advanced Mode" />
          </Row>
        </Card>

        {/* The household's stance — above the per-tool matrix, because it's the question a
            family should meet first and the only one most will ever answer. */}
        <AutonomyCard />

        {/* Risk & approvals (item 9) */}
        <RiskOverridesCard />

        {/* Data & backup */}
        <Card className="card-pad">
          <SectionTitle icon="Database">Local data & backup</SectionTitle>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-600"><Badge color={storageError ? "coral" : "sage"}>{storageLabel}</Badge><span>Schema v{data.schemaVersion}</span></div>
          {storageError && <p className="mb-3 rounded-lg bg-coral-50 px-3 py-2 text-sm text-coral-600">{storageError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => exportBackup(data)}><Icon name="Download" size={15} /> Export backup</Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()}><Icon name="Upload" size={15} /> Import backup</Button>
            <Button variant="secondary" onClick={() => setResetOpen(true)}><Icon name="RotateCcw" size={15} /> Reset sample data</Button>
            <Button variant="danger" onClick={() => setFreshOpen(true)}><Icon name="Trash2" size={15} /> Clear data & start my own</Button>
          </div>
          <p className="mt-2 text-xs text-ink-500">"Start my own" erases the sample household from this browser and takes you to first-run setup to create your own.</p>
        </Card>

        {/* Take your data with you */}
        <TakeYourDataCard />

        {/* Disclaimers */}
        <Card className="card-pad">
          <SectionTitle icon="ShieldAlert">Safety & disclaimers</SectionTitle>
          <ul className="space-y-2 text-sm text-ink-600">
            <li className="flex items-start gap-2"><Icon name="Scale" size={15} className="mt-0.5 shrink-0 text-ink-400" />Legal/document review summarizes and flags issues — <strong>not legal advice</strong>.</li>
            <li className="flex items-start gap-2"><Icon name="Stethoscope" size={15} className="mt-0.5 shrink-0 text-ink-400" />Medical and caregiving notes <strong>do not replace professional advice</strong>.</li>
            <li className="flex items-start gap-2"><Icon name="Wallet" size={15} className="mt-0.5 shrink-0 text-ink-400" />Review financial decisions before acting.</li>
            <li className="flex items-start gap-2"><Icon name="ShieldCheck" size={15} className="mt-0.5 shrink-0 text-ink-400" />Every external action runs through a real connector and an approval gate — nothing leaves the household without your say-so.</li>
          </ul>
        </Card>
      </div>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset sample data?" icon="RotateCcw" footer={<><Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => { reseed(); setResetOpen(false); }}>Reset to The Harper Family</Button></>}>
        <p className="text-sm text-ink-600">This clears local changes and restores the sample household. Export a backup first if you want to keep your changes. (Connector configuration in the backend vault is not affected.)</p>
      </Modal>

      <Modal open={freshOpen} onClose={() => setFreshOpen(false)} title="Clear data and start your own?" icon="Trash2" footer={<><Button variant="ghost" onClick={() => setFreshOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => { setFreshOpen(false); void startFresh(); }}><Icon name="Trash2" size={15} /> Erase & start setup</Button></>}>
        <p className="text-sm text-ink-600">This permanently erases the Harper sample household (members, spaces, agents, files, messages) from <strong>this browser</strong> and signs you out, then opens first-run setup so you can create your own household.</p>
        <p className="mt-2 text-sm text-ink-600">Want to keep anything first? Click <strong>Export backup</strong> — you can re-import it later. Connected accounts in the backend vault aren't touched.</p>
      </Modal>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-sand-100 py-2.5 last:border-0">
      <div><p className="text-sm font-medium text-ink-800">{label}</p>{desc && <p className="text-xs text-ink-500">{desc}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ---- Famili in the family's group chat ----
 *
 * A chat appears here only once a VERIFIED member of this household has spoken in it;
 * until then FamiliOS does not know the thread exists and holds nothing about it. That is
 * also why there is no "add a chat" button: there is nothing to type, and inviting someone
 * to type a chat id would be inviting them to guess at other people's threads.
 *
 * The card leads with whether Famili can speak at all, because out of the box it cannot:
 * speaking is a high-stakes send and an Owner has to grant it through a dial that already
 * exists. A household can flip autonomy to Trusted without ever opening the helper, so the
 * card says WHICH grant applies rather than just yes.
 */
function GroupChatsCard({ toast }: { toast: (t: Omit<Toast, "id">) => void }) {
  const [view, setView] = useState<GroupChatsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [proposalsOn, setProposalsOn] = useState(false);
  const [storeAll, setStoreAll] = useState(false);
  const [days, setDays] = useState(0);

  const load = async () => {
    const [v, s] = await Promise.all([backend.groupChats(), backend.getSettings()]);
    setView(v);
    setProposalsOn(s.chatProposalsEnabled === true);
    setStoreAll(s.storeAllChatParticipants === true);
    setDays(Number(s.chatTranscriptDays ?? 0));
  };
  useEffect(() => { void load(); }, []);

  // Nothing to show and nothing to explain: a household with no group chat should not be
  // told about a feature it has not met.
  if (!view || (view.chats.length === 0 && !view.canSpeak)) return null;

  const bind = async (id: string) => {
    setBusy(id);
    const r = await backend.bindGroupChat(id);
    setBusy(null);
    if (r.ok) { toast({ kind: "success", title: "Famili joined the chat", message: "It introduced itself once and will stay quiet unless something is clearly settled." }); void load(); }
    else toast({ kind: "error", title: "Couldn't join", message: r.message ?? r.error });
  };
  const revoke = async (id: string) => {
    setBusy(id);
    const r = await backend.revokeGroupChat(id);
    setBusy(null);
    if (r.ok) { toast({ kind: "info", title: "Famili left the chat", message: `It stays gone, and ${r.messagesDeleted ?? 0} stored messages were deleted.` }); void load(); }
    else toast({ kind: "error", title: "Couldn't leave", message: r.message ?? r.error });
  };
  /* Turning this ON changes what is kept about people who are not in the household and are
   * not FamiliOS users. Famili re-introduces itself in every chat it has joined to say so —
   * the server refuses the change outright if it cannot, because the sentence those people
   * heard when it joined would otherwise stop being true without anyone telling them. */
  const setStoreAllParticipants = async (v: boolean) => {
    const prev = storeAll;
    setStoreAll(v);
    try {
      await backend.setSettings({ storeAllChatParticipants: v });
      toast({
        kind: v ? "success" : "info",
        title: v ? "Famili keeps the whole chat" : "Famili keeps only your household's messages",
        message: v
          ? "Everyone's messages in your joined chats are kept, and included in your household export. Famili has told each chat."
          : "Anyone else's messages are no longer kept, and what was kept has been deleted. Famili has told each chat.",
      });
    } catch (e) {
      setStoreAll(prev);
      toast({ kind: "error", title: "Nothing was changed", message: e instanceof Error ? e.message : "Famili couldn't tell your chats about the change." });
    }
  };

  const setProposals = async (v: boolean) => {
    setProposalsOn(v);
    await backend.setSettings({ chatProposalsEnabled: v });
    toast({
      kind: v ? "success" : "info",
      title: v ? "Famili can offer to help" : "Famili is listening only",
      message: v ? "It will offer once when something is clearly settled, and only act if someone says yes." : "It reads and records what it would have suggested, and says nothing.",
    });
  };
  const setDaysValue = async (v: number) => {
    setDays(v);
    await backend.setSettings({ chatTranscriptDays: v });
  };

  const grantLabel = view.speakGrant === "household_trusted" ? "your household autonomy is set to Trusted"
    : view.speakGrant === "risk_override" ? "an Owner cleared the approval gate for texting"
      : "you allowed this helper to act on its own";

  return (
    <Card className="card-pad">
      <SectionTitle icon="MessageCircle">Famili in your group chat</SectionTitle>
      <p className="mt-2 text-sm text-ink-600">
        Famili can sit in a family group chat and offer to add things you have already decided on.{" "}
        {storeAll
          ? "It keeps everyone's messages in the chats it has joined, including people outside your household."
          : "It only keeps messages from your own household's members; anyone else's stay unsaved."}
      </p>

      {view.canSpeak
        ? <p className="mt-2 rounded-lg bg-sage-50 px-3 py-2 text-sm text-ink-600">Famili can speak in a chat it has joined, because {grantLabel}.</p>
        : <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-ink-600">{view.speakBlockedReason ?? "Famili can't speak in a chat yet."}</p>}

      <div className="mt-3">
        {view.chats.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-4 border-b border-sand-100 py-2.5 last:border-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-800">
                {c.displayName || c.knownParticipants.map((p) => p.name).filter(Boolean).join(", ") || "Group chat"}
              </p>
              <p className="text-xs text-ink-500">
                {c.status === "bound" ? "Famili is in this chat" : "Waiting for you to decide"}
                {c.unknownParticipantCount > 0 && ` · ${c.unknownParticipantCount} ${c.unknownParticipantCount === 1 ? "person" : "people"} outside your household (${storeAll ? "their messages are kept" : "nothing of theirs is stored"})`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {c.status === "pending" && <Button size="sm" disabled={busy === c.id || !view.canSpeak} onClick={() => void bind(c.id)}>Let Famili in</Button>}
              {c.status === "bound" && <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => void revoke(c.id)}>Remove</Button>}
            </div>
          </div>
        ))}
        {view.chats.length === 0 && <p className="py-2 text-sm text-ink-500">No group chats yet. One appears here after someone in your household texts in a group the family number is part of.</p>}
      </div>

      <div className="mt-3">
        <Row
          label="Let Famili offer to help"
          desc="Off, it reads and records what it would have suggested without saying anything. Turn it on once you have seen it get things right."
        >
          <Toggle checked={proposalsOn} onChange={(v) => void setProposals(v)} ariaLabel="Let Famili offer to help" />
        </Row>
        <Row
          label="Keep everyone's messages"
          desc="Off, Famili keeps only your own household's messages. On, it keeps everyone's in the chats it has joined — including guests and extended family who are not FamiliOS users — and those messages are included in your household export. Famili tells each chat either way."
        >
          <Toggle checked={storeAll} onChange={(v) => void setStoreAllParticipants(v)} ariaLabel="Keep everyone's messages" />
        </Row>
        <Row
          label="Keep chat history"
          desc="How long your own members' messages are kept, so Famili can tell whether something was already sorted. Zero keeps nothing beyond the current conversation."
        >
          <Select value={String(days)} onChange={(e) => void setDaysValue(Number(e.target.value))} aria-label="Keep chat history">
            <option value="0">Don't keep</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </Select>
        </Row>
      </div>
    </Card>
  );
}

/* ---- Risk & approvals (item 9) ----
 * Per-tool risk-class + skip-approval overrides. Server-enforced (the engine's
 * resolveTool applies them); this card only edits the household's override records.
 * The whole Settings screen is already Adult Admin-gated. */
const RISK_CLASSES = ["Low", "Medium", "High", "Sensitive"];
/* THE ONE QUESTION.
 *
 * Every other autonomy control in this product is per-helper or per-tool, and both are
 * advanced. A family that just wants it to work had two options: answer an approval for every
 * summary and reminder, or go learn a capability matrix. So they got the nagging — which was
 * never a decision anyone made, just the absence of one.
 *
 * The stances are enforced in server/policy.mjs rule 7 and nowhere else. This card does not
 * bulk-write per-helper flags: doing that would fight with settings a family had deliberately
 * made, and a preset would silently rewrite records every time it changed. It sets one value. */
const STANCES: { key: Autonomy; title: string; blurb: string; note: string; icon: string }[] = [
  { key: "Cautious", icon: "ShieldCheck", title: "Cautious", blurb: "Ask me about everything that isn't just reading.", note: "Most approvals. Choose this if you want to see each step for a while." },
  { key: "Balanced", icon: "Scale", title: "Balanced", blurb: "Handle everyday things here at home; ask before anything goes out.", note: "Adding tasks, drafting notes, updating lists and calendars just happen. Email, texts, purchases and anything reaching another service still ask." },
  { key: "Trusted", icon: "Zap", title: "Trusted", blurb: "Also send and spend without asking me first.", note: "Needs your household PIN. The pause switch still stops everything, and any step you mark “always ask” still waits." },
];

function AutonomyCard() {
  const toast = useStore((s) => s.toast);
  const [settings, setSettings] = useState<BackendSettings | null>(null);
  const [pendingStance, setPendingStance] = useState<Autonomy | null>(null);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setSettings(await backend.getSettings());
  useEffect(() => { void load(); }, []);

  const current: Autonomy = settings?.autonomy ?? "Cautious";
  const unanswered = settings?.autonomyDefaulted !== false;

  const apply = async (stance: Autonomy, withPin?: string) => {
    setBusy(true);
    const r = await backend.setAutonomy(stance, withPin);
    setBusy(false);
    if (!r.ok) {
      if (r.error === "pin_required" || r.error === "pin_incorrect") {
        setPendingStance(stance);
        setPinErr(r.error === "pin_incorrect" ? (r.message ?? "That PIN didn't match. Nothing was changed.") : null);
        return;
      }
      toast({ kind: "error", title: "Couldn't change this", message: r.message ?? r.error });
      return;
    }
    setPendingStance(null); setPin(""); setPinErr(null);
    setSettings(r.settings ?? null);
    toast({ kind: "success", title: `Set to ${stance}`, message: STANCES.find((s) => s.key === stance)?.blurb ?? "" });
  };

  return (
    <Card className="card-pad">
      <SectionTitle icon="SlidersHorizontal">How much should FamiliOS do on its own?</SectionTitle>
      <p className="text-sm text-ink-500">
        One answer for the whole household. You can still override it for any single helper or tool — those choices win over this one.
      </p>
      {unanswered && <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-ink-700">Nobody has answered this yet, so FamiliOS is asking you about everything. Picking <strong>Balanced</strong> is what most families want.</p>}
      <div className="mt-3 space-y-2">
        {STANCES.map((s) => {
          const on = current === s.key;
          return (
            <button key={s.key} disabled={busy} onClick={() => apply(s.key)}
              aria-pressed={on}
              className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors ${on ? "border-sage-500 bg-sage-500/[0.08]" : "border-ink-900/[0.06] bg-surface-rim hover:bg-ink-900/[0.03]"}`}>
              <Icon name={s.icon} size={16} className={`mt-0.5 shrink-0 ${on ? "text-sage-600" : "text-ink-400"}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-800">{s.title}{on && <Badge color="sage">current</Badge>}</span>
                <span className="mt-0.5 block text-sm text-ink-600">{s.blurb}</span>
                <span className="mt-0.5 block text-xs text-ink-400">{s.note}</span>
              </span>
            </button>
          );
        })}
      </div>
      {current === "Trusted" && settings?.autonomySetByRole && (
        <p className="mt-2 text-xs text-ink-400">Allowed by an {settings.autonomySetByRole}{settings.autonomySetAt ? ` on ${new Date(settings.autonomySetAt).toLocaleDateString()}` : ""}.</p>
      )}

      <Modal
        open={!!pendingStance}
        onClose={() => { setPendingStance(null); setPin(""); setPinErr(null); }}
        title="Confirm with your household PIN"
        icon="Zap"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setPendingStance(null); setPin(""); setPinErr(null); }}>Cancel</Button>
            <Button variant="primary" disabled={!pin || busy} onClick={() => apply(pendingStance!, pin)}>{busy ? "Saving…" : "Allow this"}</Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">You&apos;re allowing your family&apos;s helpers to <strong>send messages and spend money without asking first</strong>.</p>
        <p className="mt-1.5 text-sm text-ink-500">The pause switch still stops everything, and any step you&apos;ve marked &ldquo;always ask&rdquo; still waits for you. You can come back to Balanced at any time without the PIN.</p>
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void apply(pendingStance!, pin); }}>
          <TextInput type="password" value={pin} autoFocus placeholder="Household PIN" aria-label="Household PIN" onChange={(e) => { setPin(e.target.value); setPinErr(null); }} />
        </form>
        {pinErr && <p className="mt-2 text-sm text-coral-600">{pinErr}</p>}
      </Modal>
    </Card>
  );
}

/* "Give me everything you hold about my family."
 *
 * The backup buttons above are a RESTORE artifact: a gzip shaped for the importer, containing
 * the household's encrypted credentials because a restore needs them. Useful, and not an answer
 * to "what do you have on us" — you cannot read it, and handing someone their own OAuth tokens
 * is a liability nobody asked for. This is the other artifact, and it is the one Apple and GDPR
 * are actually asking about.
 *
 * Owner-only, enforced server-side: the export spans every member's personal space, so it is
 * not one person's to take. The button is simply absent for anyone else rather than present and
 * refusing — a control you can press that always fails is the thing this whole work package has
 * been removing. */
function TakeYourDataCard() {
  const toast = useStore((s) => s.toast);
  const session = useStore((s) => s.session);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<BackendSettings | null>(null);
  const [budget, setBudget] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { void (async () => { const s = await backend.getSettings(); setSettings(s); setBudget(s.aiDailyCallBudget ? String(s.aiDailyCallBudget) : ""); })(); }, []);

  /* Export is the Owner's, because it spans every member's personal space. DELETION IS NOT:
   * whether you can erase yourself must never depend on your rank, and mobile already lets any
   * member do it. Gating the whole card on Owner — which is what this did first — would have
   * left an Adult Member on the web with no way out at all. The server decides the blast radius
   * from the role either way, so the copy below has to say which one is about to happen. */
  if (!session) return null;
  const isOwner = session.role === "Owner";

  const download = async () => {
    setBusy(true);
    const r = await backend.exportHousehold();
    setBusy(false);
    if (!r.ok) { toast({ kind: "error", title: "Couldn't build the export", message: r.message ?? r.error }); return; }
    toast({ kind: "success", title: "Export downloaded", message: "Everything your family owns, minus credentials — which are listed but never included." });
  };

  const confirmDelete = async () => {
    if (!deletePassword) return;
    setDeleting(true); setDeleteErr(null);
    const r = await backend.deleteMyAccount(deletePassword);
    setDeleting(false);
    setDeletePassword("");
    if (!r.ok) {
      setDeleteErr(
        r.error === "password_incorrect" ? "That password didn't match. Nothing was deleted."
        : r.error === "not_identity_account" ? (r.message ?? "This profile signs in without an email account, so there's no account to delete.")
        : r.error === "backend_unreachable" ? "Couldn't reach the server, so nothing was deleted."
        : (r.message ?? "Couldn't delete the account."),
      );
      return;
    }
    // The server has already cleared the session and the cookie. A full reload is the honest
    // next state: everything this page is showing has just stopped existing.
    window.location.href = "/";
  };

  const saveBudget = async () => {
    const n = budget.trim() === "" ? 0 : Number(budget);
    const r = await backend.setSettings({ aiDailyCallBudget: Number.isFinite(n) ? n : -1 });
    const fresh = await backend.getSettings();
    setSettings(fresh);
    setBudget(fresh.aiDailyCallBudget ? String(fresh.aiDailyCallBudget) : "");
    if (fresh.aiDailyCallBudget === (Number.isFinite(n) && n > 0 ? Math.floor(n) : null)) {
      toast({ kind: "success", title: fresh.aiDailyCallBudget ? `Capped at ${fresh.aiDailyCallBudget} calls a day` : "Daily cap removed" });
    } else {
      toast({ kind: "error", title: "Couldn't save that", message: "A daily cap is a whole number of calls, or blank for no limit." });
    }
    void r;
  };

  return (
    <Card className="card-pad">
      <SectionTitle icon="PackageOpen">Your family's data</SectionTitle>
      {isOwner && (
        <>
          <p className="text-sm text-ink-500">Everything FamiliOS holds for your household, as a readable file you can keep, move, or hand to anyone you like.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={download}>
              <Icon name={busy ? "Loader2" : "Download"} size={15} className={busy ? "animate-spin" : ""} /> {busy ? "Building it…" : "Download my family's data"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-400">
            Includes your calendar, tasks, meals, lists, helpers, memories, contacts and the full activity log. Credentials — connector keys and sign-in tokens — are named but never included; they are no use outside this server and shipping them would be a risk to you.
          </p>
        </>
      )}

      {/* Erasure sits with export because they are the same right, and a family that has just
          been shown how to take their data with them is exactly who should find this next. */}
      {/* Omitted, not disabled, for a PIN-model profile: there is no account to delete and the
          server would only ever refuse. Those profiles are removed by an Owner in Household. */}
      {settings?.hasIdentity && (
      <div className={`${isOwner ? "mt-4 border-t border-ink-900/[0.06] pt-3" : ""}`}>
        <p className="text-sm font-semibold text-ink-800">Delete my account</p>
        <p className="mt-0.5 text-xs text-ink-500">
          {isOwner
            ? <>You&apos;re the Owner, so this deletes <strong>the whole household</strong> — every member&apos;s calendar, tasks, files, helpers and history, the backups, and everyone&apos;s sign-in. It cannot be undone. Download your data first if you want to keep it.</>
            : <>This deletes <strong>your own account</strong> and signs you out. The rest of your household is untouched. It cannot be undone.</>}
        </p>
        <div className="mt-2">
          <Button variant="danger" onClick={() => { setDeleteOpen(true); setDeletePassword(""); setDeleteErr(null); }}>
            <Icon name="Trash2" size={15} /> Delete my account
          </Button>
        </div>
      </div>
      )}

      <Modal
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false); setDeletePassword(""); setDeleteErr(null); }}
        title={isOwner ? "Delete the whole household?" : "Delete your account?"}
        icon="AlertTriangle"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDeleteOpen(false); setDeletePassword(""); setDeleteErr(null); }}>Keep my account</Button>
            <Button variant="danger" disabled={!deletePassword || deleting} onClick={confirmDelete}>{deleting ? "Deleting…" : isOwner ? "Delete everything" : "Delete my account"}</Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          {isOwner
            ? <>This removes every member&apos;s data, this household&apos;s backups, and everyone&apos;s ability to sign in. <strong>It cannot be undone.</strong></>
            : <>This removes your account and signs you out. Your household carries on without you. <strong>It cannot be undone.</strong></>}
        </p>
        <p className="mt-1.5 text-sm text-ink-500">Enter your account password to confirm.</p>
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void confirmDelete(); }}>
          <TextInput type="password" value={deletePassword} autoFocus placeholder="Your password" aria-label="Your account password" onChange={(e) => { setDeletePassword(e.target.value); setDeleteErr(null); }} />
        </form>
        {deleteErr && <p className="mt-2 text-sm text-coral-600">{deleteErr}</p>}
      </Modal>

      {/* The dial that was enforced and could not be turned. */}
      <div className="mt-4 border-t border-ink-900/[0.06] pt-3">
        <Field label="Daily AI call limit" hint="A safety net against a runaway loop or a surprise bill. Leave blank for no limit.">
          <div className="flex items-center gap-2">
            <TextInput type="number" inputMode="numeric" min={0} value={budget} placeholder="No limit" onChange={(e) => setBudget(e.target.value)} className="!w-40" />
            <Button variant="secondary" onClick={saveBudget}>Save</Button>
            {settings && (
              <span className="text-xs text-ink-400">
                {settings.aiCallsToday ?? 0} used today{settings.aiDailyCallBudget ? ` of ${settings.aiDailyCallBudget}` : ""}
              </span>
            )}
          </div>
        </Field>
      </div>
    </Card>
  );
}

function RiskOverridesCard() {
  const toast = useStore((s) => s.toast);
  const [catalog, setCatalog] = useState<CatalogTool[]>([]);
  const [overrides, setOverrides] = useState<RiskOverride[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const r = await backend.riskOverrides();
    if (r) { setCatalog(r.catalog); setOverrides(r.overrides); }
    setLoaded(true);
  };
  useEffect(() => { if (open && !loaded) void load(); }, [open, loaded]);

  /* THIS CARD COULD NOT SAVE. The server has required the household PIN on a risk-override
   * write since Cluster W; the web client never sent one, so on any household that has set a
   * PIN — which is every household that has configured autonomy, and production — every
   * toggle here returned 403 `pin_required` and surfaced as a generic "Couldn't save".
   * Mobile passed the PIN and worked, so the control existed on paper and was dead on the
   * larger surface people actually use for it. Now it asks, once, at the moment of the act.
   *
   * Only the DANGEROUS direction can trip the prompt; clearing an override goes straight
   * through, matching the server (which gates the write, not the reset). */
  const [pending, setPending] = useState<{ tool: CatalogTool; next: { riskClass: string | null; skipApproval: boolean }; skipping: boolean } | null>(null);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const ovFor = (toolId: string) => overrides.find((o) => o.toolId === toolId);

  const save = async (t: CatalogTool, next: { riskClass: string | null; skipApproval: boolean }, skipping: boolean, withPin?: string) => {
    const r = await backend.setRiskOverride(t.toolId, { ...next, ...(withPin ? { pin: withPin } : {}) });
    if (!r.override) return { ok: false as const, error: r.error, message: (r as { message?: string }).message };
    if (skipping) toast({ kind: "warn", title: "Approval skipped for this tool", message: `${t.name} will now run without asking. Every use is still audited. Undo here anytime.` });
    return { ok: true as const };
  };

  const apply = async (t: CatalogTool, patch: { riskClass?: string | null; skipApproval?: boolean }) => {
    const current = ovFor(t.toolId);
    const next = { riskClass: patch.riskClass !== undefined ? patch.riskClass : (current?.riskClass ?? null), skipApproval: patch.skipApproval !== undefined ? patch.skipApproval : (current?.skipApproval ?? false) };
    // Both back to defaults → clear the override entirely rather than storing a no-op.
    if (next.riskClass == null && !next.skipApproval) {
      const r = await backend.clearRiskOverride(t.toolId);
      if (!r.ok && current) { toast({ kind: "error", title: "Couldn't reset", message: r.error }); return; }
      await load();
      return;
    }
    const out = await save(t, next, !!patch.skipApproval);
    if (!out.ok) {
      // The one error that is a QUESTION rather than a failure: ask for the PIN and retry
      // the identical write, instead of reporting "couldn't save" for a change the person
      // is perfectly entitled to make.
      if (out.error === "pin_required") { setPin(""); setPinErr(null); setPending({ tool: t, next, skipping: !!patch.skipApproval }); return; }
      toast({ kind: "error", title: "Couldn't save", message: out.message ?? out.error });
      return;
    }
    await load();
  };

  const confirmWithPin = async () => {
    if (!pending || !pin) return;
    setPinBusy(true); setPinErr(null);
    const out = await save(pending.tool, pending.next, pending.skipping, pin);
    setPinBusy(false);
    if (!out.ok) { setPinErr(out.message ?? "That didn't work. Nothing was changed."); return; }
    setPending(null); setPin("");
    await load();
  };

  const groups = catalog.reduce<Record<string, CatalogTool[]>>((acc, t) => { (acc[t.connectorName] ??= []).push(t); return acc; }, {});
  return (
    <Card className="card-pad">
      <SectionTitle icon="ShieldCheck" action={<Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Configure"}</Button>}>Risk & approvals</SectionTitle>
      <p className="text-sm text-ink-500">Re-class any tool's risk or let it run without a human approval. Changes apply to this household only, are enforced server-side, and every skipped gate is still logged in the audit trail.</p>
      {open && !loaded && <p className="mt-3 flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading tool catalog…</p>}
      {open && loaded && (
        <div className="mt-3 space-y-4">
          {Object.entries(groups).map(([conn, tools]) => (
            <div key={conn}>
              <p className="section-title mb-1.5">{conn}</p>
              <div className="space-y-1.5">
                {tools.map((t) => {
                  const ov = ovFor(t.toolId);
                  return (
                    <div key={t.toolId} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-900/[0.06] bg-surface-rim px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-800">{t.name} {t.riskOverridden && <Badge color="amber">custom</Badge>}</p>
                        <p className="text-[11px] text-ink-400">{t.action} · default {t.defaultRisk ?? t.risk}{(t.defaultRequiresApproval ?? t.requiresApproval) ? " · asks approval" : ""}</p>
                      </div>
                      <Select value={ov?.riskClass ?? ""} onChange={(e) => apply(t, { riskClass: e.target.value || null })} className="!w-32" aria-label={`Risk class for ${t.name}`}>
                        <option value="">Default</option>
                        {RISK_CLASSES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                      {/* WP-105: "Skip approval" sits after a fixed-width Select in a
                          flex-wrap row, so at narrow widths it was getting cut. shrink-0 +
                          nowrap make it move to its own line as a unit rather than
                          clipping — a half-read label on an approval control is exactly
                          the kind of thing you must never have to guess at. */}
                      {(t.defaultRequiresApproval ?? t.requiresApproval) && (
                        <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ink-600">
                          <Toggle checked={!!ov?.skipApproval} onChange={(v) => apply(t, { skipApproval: v })} ariaLabel={`Skip approval for ${t.name}`} />
                          Skip approval
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={!!pending}
        onClose={() => { setPending(null); setPin(""); setPinErr(null); }}
        title="Confirm with your household PIN"
        icon="ShieldCheck"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setPending(null); setPin(""); setPinErr(null); }}>Cancel</Button>
            <Button variant="primary" disabled={!pin || pinBusy} onClick={confirmWithPin}>{pinBusy ? "Saving…" : "Confirm change"}</Button>
          </>
        }
      >
        {pending && (
          <>
            <p className="text-sm text-ink-600">
              {pending.skipping
                ? <>You're allowing <strong>{pending.tool.name}</strong> to run without asking anyone first.</>
                : <>You're changing how <strong>{pending.tool.name}</strong> is classed, which changes when FamiliOS stops to ask.</>}
            </p>
            <p className="mt-1.5 text-sm text-ink-500">Changing who has to approve what needs the household PIN — the same one that protects Owner sign-in.</p>
            <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void confirmWithPin(); }}>
              <TextInput type="password" value={pin} autoFocus placeholder="Household PIN" aria-label="Household PIN" onChange={(e) => { setPin(e.target.value); setPinErr(null); }} />
            </form>
            {pinErr && <p className="mt-2 text-sm text-coral-600">{pinErr}</p>}
          </>
        )}
      </Modal>
    </Card>
  );
}
