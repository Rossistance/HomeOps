import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { Button, Card, Field, TextInput } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { brand } from "@/brand";
import { importBackup } from "@/storage/backup";
import { setAdvancedMode } from "@/lib/prefs";
import { backend } from "@/connectors/api";

/**
 * First-run onboarding. A fresh, no-data launch lands here (no auto-seeded
 * household). The user explicitly creates a household, restores a backup, or
 * loads the clearly-labelled sample — then a profile session is established.
 */
export function Onboarding() {
  const complete = useStore((s) => s.completeOnboarding);
  const signupHousehold = useStore((s) => s.signupHousehold);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<"choose" | "create" | "create-claimed">("choose");
  const [household, setHousehold] = useState("");
  const [owner, setOwner] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // T-03: check up front whether this server already belongs to a different household.
  // If it does, "Create household" must register a real account with the server (the
  // email-signup path) instead of the local-only path, which would silently create the
  // household only in this browser and then strand it behind the other household's
  // Lock screen roster. `claimed === null` means "unknown" (still checking, or the
  // server couldn't be reached) — in that case the local-only flow stays the default.
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [serverUnreachable, setServerUnreachable] = useState(false);
  useEffect(() => {
    void backend.profiles().then((r) => {
      if (!r) { setServerUnreachable(true); return; }
      setClaimed(r.claimed);
    });
  }, []);

  const onImport = async (file: File) => {
    setBusy(true);
    const r = await importBackup(file);
    setBusy(false);
    if (!r.ok || !r.data) { toast({ kind: "error", title: "Import failed", message: r.error }); return; }
    await complete("import", { data: r.data });
  };

  const onCreateClaimed = async () => {
    setBusy(true);
    setAdvancedMode(false);
    await signupHousehold({
      email: email.trim(), password, ownerName: owner.trim(),
      householdName: household.trim() || undefined, resetLocalData: true,
    });
    setBusy(false);
  };

  return (
    <div className="min-h-screen w-full bg-surface-base px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-3xl animate-slide-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-ink-700 to-ink-900 text-sage-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_16px_rgba(23,27,38,0.22)]"><Icon name="House" size={30} /></span>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">Welcome to {brand.name}</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-600">{brand.oneLiner} Let's set up your household. Everything stays on this device until you connect a provider.</p>
        </div>

        {serverUnreachable && (
          <p role="status" className="mb-4 flex items-center justify-center gap-1.5 text-center text-xs text-amber-600">
            <Icon name="TriangleAlert" size={13} className="shrink-0" /> Can't reach the FamiliOS server right now — you can still create a household, explore the sample, or restore a backup locally on this device.
          </p>
        )}

        {mode === "choose" ? (
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ChoiceCard index={0} icon="HousePlus" title="Create household" body={claimed ? "This server already has a household — create your own account to get a private space on it." : "Start fresh with your own household and an owner profile."} action="Create" onClick={() => setMode(claimed ? "create-claimed" : "create")} primary />
            <ChoiceCard index={1} icon="Upload" title="Restore a backup" body="Import a FamiliOS backup file you exported earlier." action={busy ? "Importing…" : "Choose file"} onClick={() => fileRef.current?.click()} />
            <ChoiceCard index={2} icon="Sparkles" title="Explore the sample" body="Load the Harper family — clearly-labelled sample data to explore features." action="Load sample" onClick={() => complete("sample")} />
          </div>
        ) : mode === "create" ? (
          <Card className="card-pad mx-auto max-w-lg animate-scale-in">
            <button className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800" onClick={() => setMode("choose")}><Icon name="ChevronLeft" size={15} /> Back</button>
            <h2 className="font-display text-xl font-semibold text-ink-900">Create your household</h2>
            <p className="mb-4 text-sm text-ink-500">You'll be the Owner. You can add family members and helpers later.</p>
            <div className="space-y-3">
              <Field label="Household name"><TextInput value={household} placeholder="The Rivera Family" onChange={(e) => setHousehold(e.target.value)} /></Field>
              <Field label="Your name (owner)"><TextInput value={owner} placeholder="Your name" onChange={(e) => setOwner(e.target.value)} /></Field>
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-sky-200/70 bg-sky-50 px-3.5 py-2.5 text-xs text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
              <Icon name="Sparkles" size={15} className="mt-0.5 shrink-0" />
              <span>You'll start in <strong>Simple mode</strong> — just Ask {brand.name}, Helpers, Automations, and the family essentials. Turn on <strong>Advanced tools</strong> (Skills &amp; Functions) anytime in Settings.</span>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ember" disabled={busy || !owner.trim()} onClick={async () => { setBusy(true); setAdvancedMode(false); await complete("blank", { householdName: household, ownerName: owner }); }}>
                <Icon name="Check" size={15} /> Create household
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="card-pad mx-auto max-w-lg animate-scale-in">
            <button className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800" onClick={() => setMode("choose")}><Icon name="ChevronLeft" size={15} /> Back</button>
            <h2 className="font-display text-xl font-semibold text-ink-900">Create your household</h2>
            <p className="mb-4 text-sm text-ink-500">This server already belongs to a different household. Create your own account and you'll get a completely separate, private space on it.</p>
            <div className="space-y-3">
              <Field label="Household name (optional)"><TextInput value={household} placeholder="The Rivera Family" onChange={(e) => setHousehold(e.target.value)} /></Field>
              <Field label="Your name (owner)"><TextInput value={owner} placeholder="Your name" onChange={(e) => setOwner(e.target.value)} /></Field>
              <Field label="Email"><TextInput type="email" value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Password"><TextInput type="password" value={password} placeholder="At least 8 characters" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onCreateClaimed(); }} /></Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ember" disabled={busy || !owner.trim() || !email.trim() || password.length < 8} onClick={() => void onCreateClaimed()}>
                <Icon name="Check" size={15} /> Create household
              </Button>
            </div>
          </Card>
        )}

        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }} />
        <p className="mt-8 text-center text-xs text-ink-400">Your household data is stored locally in this browser. Connectors and secrets are managed by the backend vault — never in the browser.</p>
        <p className="mt-2 text-center text-xs text-ink-400">
          <a href="/privacy.html" className="underline hover:text-ink-600">Privacy Policy</a>
          <span aria-hidden="true"> · </span>
          <a href="/terms.html" className="underline hover:text-ink-600">SMS Terms &amp; Conditions</a>
        </p>
      </div>
    </div>
  );
}

function ChoiceCard({ index, icon, title, body, action, onClick, primary }: { index?: number; icon: string; title: string; body: string; action: string; onClick: () => void; primary?: boolean }) {
  return (
    <div style={{ ["--i" as string]: index ?? 0 }}>
      <Card hover className="card-pad flex h-full flex-col">
        <span className={`mb-3 flex h-11 w-11 items-center justify-center rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] ${primary ? "bg-gradient-to-br from-ink-700 to-ink-900 text-sage-400" : "bg-surface-sunken text-ink-700"}`}><Icon name={icon} size={22} /></span>
        <p className="font-display text-lg font-semibold text-ink-900">{title}</p>
        <p className="mt-1 flex-1 text-sm text-ink-500">{body}</p>
        <Button className="mt-4 w-full justify-center" variant={primary ? "ember" : "secondary"} onClick={onClick}>{action}</Button>
      </Card>
    </div>
  );
}
