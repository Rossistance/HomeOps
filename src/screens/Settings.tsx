import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { brand } from "@/brand";
import { exportBackup, importBackup } from "@/storage/backup";
import { PageHeader, Card, SectionTitle, Button, Toggle, Select, Badge, Modal, HealthDot, Field, TextInput, Avatar } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AIProvidersPanel } from "@/screens/AIProviders";
import { backend, type CatalogTool, type RiskOverride, type Autonomy, type BackendSettings } from "@/connectors/api";
import { useCalmMode, useAdvancedMode, useUnifiedNav } from "@/lib/prefs";

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
  const toggleSoloMode = useStore((s) => s.toggleSoloMode);
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
  const [unifiedNav, setUnifiedNav] = useUnifiedNav();
  const setOwnerPin = async () => { if (!pin) return; await backend.setSettings({ ownerPin: pin }); setPin(""); toast({ kind: "success", title: "Owner PIN set", message: "Elevated profiles now require this PIN to sign in." }); };
  // Calendar auto-sync (server-owned, Adult Admin): pre-authorized Google pushes + two-way sweep.
  const [calendarAutoSync, setCalendarAutoSync] = useState(false);
  // Auto-approve low-risk improvements (server-owned, Adult Admin): the server applies
  // low-risk evolution proposals without a human and labels each one. Default on.
  const [autoApproveImprovements, setAutoApproveImprovements] = useState(true);
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
  useEffect(() => { void backend.getSettings().then((s) => { setCalendarAutoSync(s.calendarAutoSync === true); setAutoApproveImprovements(s.autoApproveImprovements !== false); setTimezoneState(s.timezone ?? null); setHideProfilesPreAuth(s.hideProfilesPreAuth === true); }); }, []);
  const setTimezone = async (tz: string) => {
    setTimezoneState(tz);
    const s = await backend.setSettings({ timezone: tz });
    setTimezoneState(s.timezone ?? null);
    toast({ kind: "success", title: "Timezone set", message: `Scheduled automations (like a 7 AM briefing) now anchor to ${tz}.` });
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
  const toggleAutoApproveImprovements = async (v: boolean) => {
    setAutoApproveImprovements(v);
    const s = await backend.setSettings({ autoApproveImprovements: v });
    setAutoApproveImprovements(s.autoApproveImprovements !== false);
    toast({ kind: v ? "success" : "info", title: v ? "Auto-approving low-risk improvements" : "Auto-approve off", message: v ? "FamiliOS applies low-risk improvements automatically and labels each one." : "Every improvement now waits for your review." });
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
          <Row label="Auto-approve low-risk improvements" desc="Let FamiliOS apply the low-risk improvements it learns from run traces automatically. Each auto-applied change is labelled and logged; higher-risk ideas still wait for your review.">
            <Toggle checked={autoApproveImprovements} onChange={(v) => void toggleAutoApproveImprovements(v)} ariaLabel="Auto-approve low-risk improvements" />
          </Row>
          <Row label="Household timezone" desc={timezone ? "Scheduled automations (like a daily briefing) fire at this wall-clock time." : `Not set — scheduled automations currently anchor to the SERVER's clock, not your household's. This browser is in ${browserTz}.`}>
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
          <p className="mb-2 text-sm text-ink-500">{connectors.filter((c) => c.live).length} of {connectors.length} connectors are live. Configure providers, OAuth, API keys, and webhooks in Connections.</p>
          <div className="flex flex-wrap gap-1.5">{connectors.map((c) => <Badge key={c.id} color="gray">{c.name}</Badge>)}</div>
        </Card>

        {/* AI providers (real adapters) */}
        <Card className="card-pad">
          <SectionTitle icon="Sparkles">AI providers</SectionTitle>
          <AIProvidersPanel />
        </Card>

        {/* Privacy */}
        <Card className="card-pad">
          <SectionTitle icon="Lock">Privacy</SectionTitle>
          <Row label="Sensitive memories stay within their space"><Toggle checked={settings.privacy.sensitiveMemoryStaysInSpace} onChange={(v) => updateSettings({ privacy: { ...settings.privacy, sensitiveMemoryStaysInSpace: v } })} /></Row>
          <Row label="Require approval for actions outside the household"><Toggle checked={settings.privacy.requireApprovalForExternal} onChange={(v) => updateSettings({ privacy: { ...settings.privacy, requireApprovalForExternal: v } })} /></Row>
          <Row label="Hide family names on the sign-in screen" desc="Until someone signs in, this device's profile picker shows no names (ISS-015 privacy flag; enforced server-side)."><Toggle checked={hideProfilesPreAuth} onChange={(v) => void toggleHideProfilesPreAuth(v)} ariaLabel="Hide family names on the sign-in screen" /></Row>
        </Card>

        {/* Notifications */}
        <Card className="card-pad">
          <SectionTitle icon="Bell">Notifications</SectionTitle>
          <Row label="In-app notifications"><Toggle checked={settings.notifications.inApp} onChange={(v) => updateSettings({ notifications: { ...settings.notifications, inApp: v } })} /></Row>
          <Row label="Email digest" desc="Requires a configured email connector."><Toggle checked={settings.notifications.emailDigest} onChange={(v) => updateSettings({ notifications: { ...settings.notifications, emailDigest: v } })} /></Row>
          <Row label="Text-style alerts" desc="Requires a configured messaging connector."><Toggle checked={settings.notifications.textAlerts} onChange={(v) => updateSettings({ notifications: { ...settings.notifications, textAlerts: v } })} /></Row>
        </Card>

        {/* Appearance & solo mode */}
        <Card className="card-pad">
          <SectionTitle icon="Palette">Appearance & branding</SectionTitle>
          <Row label="Theme"><Select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as "warm" | "warm-contrast" })} className="!w-44"><option value="warm">Warm</option><option value="warm-contrast">Warm (higher contrast)</option></Select></Row>
          <p className="mt-2 rounded-lg bg-sand-50 px-3 py-2 text-sm text-ink-500">Rename the whole product in <code className="rounded bg-sand-200 px-1">src/brand.ts</code> — currently “{brand.name}”.</p>
          <Row label="Solo Professional Mode" desc="Optionally surfaces side-business workflows. Off by default — FamiliOS is family-first."><Toggle checked={settings.soloProfessionalMode} onChange={() => toggleSoloMode()} /></Row>
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
          <Row label="Unified Helper Agents (preview)" desc="Make Helper Agents the one place to build, schedule, and run household helpers. Automations folds in as a scheduling view, and the low-level Skills, Functions, and Workflow builders move behind Advanced Mode. Your existing automations and screens are untouched — only where they live in the menu changes.">
            <Toggle checked={unifiedNav} onChange={(v) => setUnifiedNav(v)} ariaLabel="Unified Helper Agents navigation" />
          </Row>
          <Row label="Advanced Mode" desc="Show the Skills and Functions builders — the low-level building blocks agents and automations run on. Most households never need to open these directly.">
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
