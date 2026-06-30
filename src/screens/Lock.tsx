import { useState } from "react";
import { useStore } from "@/store/useStore";
import { Avatar, Button, Card, Field, TextInput } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { brand } from "@/brand";

/**
 * Profile lock screen. A real session boundary: choosing a profile establishes an
 * authenticated backend session (httpOnly cookie + CSRF) whose role gates the
 * control plane and the UI. Elevated roles can be protected by an owner PIN.
 */
export function Lock() {
  const data = useStore((s) => s.data);
  const loginAs = useStore((s) => s.loginAs);
  const authBusy = useStore((s) => s.authBusy);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  const members = data.members;
  const owner = data.members.find((m) => m.id === data.household.ownerMemberId);

  const choose = async (memberId: string, role: string) => {
    const elevated = role === "Owner" || role === "Adult Admin";
    if (elevated && pinFor !== memberId) {
      // Try without a PIN first; if the server requires one, reveal the field.
      const ok = await loginAs(memberId);
      if (!ok) setPinFor(memberId);
      return;
    }
    const ok = await loginAs(memberId, pin);
    if (ok) { setPinFor(null); setPin(""); }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-surface-base px-4 py-10">
      <div className="w-full max-w-2xl animate-slide-up">
        {/* ───────────────────────── Brand moment (the Hearth) ───────────────────────── */}
        <div className="hearth card-pad mb-7 text-center animate-scale-in sm:p-7">
          <span className="hearth-glow" aria-hidden="true" />
          <div className="relative z-10 flex flex-col items-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-ember-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur"><Icon name="House" size={28} /></span>
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Who's using {brand.shortName}?</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70">{data.household.name} · choose a profile to continue. Your role controls what you can see and do.</p>
          </div>
        </div>

        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
          {members.map((m, i) => (
            <Card key={m.id} className="card-pad flex flex-col items-center text-center" hover onClick={() => choose(m.id, m.role)}>
              <span style={{ ["--i" as string]: i }} className="flex flex-col items-center">
                <Avatar initials={m.initials} color={m.avatarColor} size={48} />
                <p className="font-display mt-2.5 truncate text-base font-semibold text-ink-900">{m.displayName}</p>
                <p className="text-xs font-medium text-ink-500">{m.role}</p>
                {(m.role === "Owner" || m.role === "Adult Admin") && <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-ink-400"><Icon name="Lock" size={10} /> may need PIN</span>}
              </span>
            </Card>
          ))}
        </div>

        {pinFor && (
          <Card className="card-pad mx-auto mt-5 max-w-sm animate-slide-up">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-800"><Icon name="Lock" size={15} className="text-lavender-600" /> Enter owner PIN for {members.find((m) => m.id === pinFor)?.displayName}</p>
            <Field label="Owner PIN">
              <TextInput type="password" value={pin} autoFocus placeholder="••••" onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void choose(pinFor, members.find((m) => m.id === pinFor)?.role ?? "Adult Admin"); }} />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button variant="ember" disabled={authBusy || !pin} onClick={() => void choose(pinFor, members.find((m) => m.id === pinFor)?.role ?? "Adult Admin")}><Icon name="LogIn" size={16} /> Sign in</Button>
              <Button variant="ghost" onClick={() => { setPinFor(null); setPin(""); }}>Cancel</Button>
            </div>
          </Card>
        )}

        <p className="mt-8 text-center text-xs text-ink-400">{owner ? `Owner: ${owner.displayName}. ` : ""}A profile session is required to use connectors and approve actions.</p>
      </div>
    </div>
  );
}
