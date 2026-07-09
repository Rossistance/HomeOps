import { useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { Button, Card, Field, TextInput } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { brand } from "@/brand";
import { importBackup } from "@/storage/backup";

/**
 * First-run onboarding. A fresh, no-data launch lands here (no auto-seeded
 * household). The user explicitly creates a household, restores a backup, or
 * loads the clearly-labelled sample — then a profile session is established.
 */
export function Onboarding() {
  const complete = useStore((s) => s.completeOnboarding);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<"choose" | "create">("choose");
  const [household, setHousehold] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    setBusy(true);
    const r = await importBackup(file);
    setBusy(false);
    if (!r.ok || !r.data) { toast({ kind: "error", title: "Import failed", message: r.error }); return; }
    await complete("import", { data: r.data });
  };

  return (
    <div className="min-h-screen w-full bg-surface-base px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-3xl animate-slide-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-ink-700 to-ink-900 text-sage-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_16px_rgba(23,27,38,0.22)]"><Icon name="House" size={30} /></span>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">Welcome to {brand.name}</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-600">{brand.oneLiner} Let's set up your household. Everything stays on this device until you connect a provider.</p>
        </div>

        {mode === "choose" ? (
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ChoiceCard index={0} icon="HousePlus" title="Create household" body="Start fresh with your own household and an owner profile." action="Create" onClick={() => setMode("create")} primary />
            <ChoiceCard index={1} icon="Upload" title="Restore a backup" body="Import a FamiliOS backup file you exported earlier." action={busy ? "Importing…" : "Choose file"} onClick={() => fileRef.current?.click()} />
            <ChoiceCard index={2} icon="Sparkles" title="Explore the sample" body="Load the Harper family — clearly-labelled sample data to explore features." action="Load sample" onClick={() => complete("sample")} />
          </div>
        ) : (
          <Card className="card-pad mx-auto max-w-lg animate-scale-in">
            <button className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800" onClick={() => setMode("choose")}><Icon name="ChevronLeft" size={15} /> Back</button>
            <h2 className="font-display text-xl font-semibold text-ink-900">Create your household</h2>
            <p className="mb-4 text-sm text-ink-500">You'll be the Owner. You can add family members and helpers later.</p>
            <div className="space-y-3">
              <Field label="Household name"><TextInput value={household} placeholder="The Rivera Family" onChange={(e) => setHousehold(e.target.value)} /></Field>
              <Field label="Your name (owner)"><TextInput value={owner} placeholder="Your name" onChange={(e) => setOwner(e.target.value)} /></Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ember" disabled={busy || !owner.trim()} onClick={async () => { setBusy(true); await complete("blank", { householdName: household, ownerName: owner }); }}>
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
