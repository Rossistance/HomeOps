import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { backend, getHouseholdHint, saveHouseholdHint } from "@/connectors/api";
import { Avatar, Button, Card, Field, TextInput } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { brand } from "@/brand";

/**
 * Profile lock screen. A real session boundary: choosing a profile establishes an
 * authenticated backend session (httpOnly cookie + CSRF) whose role gates the
 * control plane and the UI. Elevated roles can be protected by an owner PIN.
 *
 * Profiles come from the SERVER registry (/api/profiles) — the same roster the
 * iOS app shows — so archived demo members and sample data can never appear.
 * The local store is only a fallback when the backend is unreachable.
 */
interface LockProfile { id: string; displayName: string; role: string; initials: string; avatarColor: string; pinRequired?: boolean; origin: "server" | "local" }

const AV = ["ember", "sage", "sky", "lavender", "amber", "ink"];
const colorFor = (name: string) => AV[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
const initialsOf = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function Lock() {
  const data = useStore((s) => s.data);
  const loginAs = useStore((s) => s.loginAs);
  const loginWithEmail = useStore((s) => s.loginWithEmail);
  const signupHousehold = useStore((s) => s.signupHousehold);
  const authBusy = useStore((s) => s.authBusy);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [serverProfiles, setServerProfiles] = useState<LockProfile[] | null>(null);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  // WP-010 session-scoped picker (ISS-012): a returning member's browser remembers which
  // signed-up household it last used, so after sign-out the Lock screen offers THAT family's
  // own members (children included) instead of the resident household's roster.
  const [hint] = useState(() => getHouseholdHint());
  const [needPasswordFor, setNeedPasswordFor] = useState<string | null>(null);
  // C1.4 email identity: sign in / create-or-join a household of your own.
  const [emailMode, setEmailMode] = useState<null | "signin" | "create">(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [invitePreview, setInvitePreview] = useState<{ householdName: string | null; role: string } | null>(null);

  // An invite link (?invite=CODE) drops the person straight into the join form.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("invite");
    if (code) { setInviteToken(code); setEmailMode("create"); }
  }, []);
  useEffect(() => {
    const t = inviteToken.trim();
    if (!t) { setInvitePreview(null); return; }
    void backend.invitePreview(t).then((inv) => setInvitePreview(inv ? { householdName: inv.householdName, role: inv.role } : null));
  }, [inviteToken]);

  const submitEmail = async () => {
    if (emailMode === "signin") { await loginWithEmail(email.trim(), password); return; }
    await signupHousehold({
      email: email.trim(), password, ownerName: ownerName.trim(),
      ...(inviteToken.trim() ? { inviteToken: inviteToken.trim() } : { householdName: newHouseholdName.trim() || undefined }),
    });
  };

  useEffect(() => {
    // A reachable server always yields a `profiles` array (possibly empty) — only a
    // network/parse failure returns null. Track those separately: "offline" (server
    // genuinely unreachable) is a different, honest story from "reachable, but this
    // browser's household isn't the one it knows about" (handled below via the merge).
    void backend.profiles(hint?.id).then((r) => {
      if (!r) { setOffline(true); setServerProfiles(null); return; }
      setOffline(false);
      setServerProfiles(r.profiles.map((p) => ({
        id: p.actorId, displayName: p.displayName, role: p.role,
        initials: initialsOf(p.displayName), avatarColor: colorFor(p.displayName),
        pinRequired: p.pinRequired, origin: "server" as const,
      })));
      if (r.householdName) { setHouseholdName(r.householdName); if (hint?.id) saveHouseholdHint(hint.id, r.householdName); }
    });
  }, [hint?.id]);

  const localMembers: LockProfile[] = data.members.map((m) => ({
    id: m.id, displayName: m.displayName, role: m.role,
    initials: m.initials, avatarColor: m.avatarColor, origin: "local" as const,
  }));
  // T-03: the server is reachable and answered with SOMEONE's roster, but none of this
  // browser's local household is in it — this server already belongs to a different
  // household. Rather than hiding the local household behind that roster (the old
  // behavior — "create/reset sample" would then dead-end here with no way back in),
  // merge it in, clearly labelled as local-only.
  // WP-010: when a household hint drove the fetch, the returned roster IS that signed-up
  // family's own members — authoritative, so it's shown alone (never merged with this
  // browser's local sample/resident members).
  const hinted = !!hint?.id && serverProfiles !== null && serverProfiles.length > 0;
  const localIds = new Set(localMembers.map((m) => m.id));
  const foreignServer = !hinted && serverProfiles !== null && serverProfiles.length > 0 && !serverProfiles.some((p) => localIds.has(p.id));
  const members: LockProfile[] =
    hinted ? serverProfiles!                                                 // remembered signed-up household → its own roster
    : serverProfiles === null ? localMembers                                 // fully offline → local roster only
    : foreignServer ? [...serverProfiles, ...localMembers]                   // claimed by someone else → merge
    : serverProfiles.length > 0 ? serverProfiles                             // matches / includes our household
    : localMembers;                                                          // reachable but an empty roster
  const owner = members.find((m) => m.role === "Owner");
  const subtitle = householdName ?? (serverProfiles && !foreignServer ? null : data.household.name);

  // WP-010: entering a member of a remembered signed-up household carries the hint so the
  // server resolves the role from THAT household. A member who authenticates by email +
  // password answers "password_required" → we reveal the sign-in form (no passwordless entry
  // into a credentialed profile). Resident-household entry is unchanged (no hint).
  const householdHint = hinted ? hint?.id : undefined;
  const choose = async (p: LockProfile) => {
    const elevated = p.role === "Owner" || p.role === "Adult Admin";
    if (elevated && pinFor !== p.id) {
      const ok = await loginAs(p.id, undefined, p, householdHint);
      if (ok === "password_required") { setNeedPasswordFor(p.displayName); setEmailMode("signin"); return; }
      if (!ok) setPinFor(p.id);
      return;
    }
    const ok = await loginAs(p.id, pin, p, householdHint);
    if (ok === "password_required") { setNeedPasswordFor(p.displayName); setEmailMode("signin"); return; }
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
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70">
              {subtitle ? `${subtitle} — choose a profile to continue.` : "Choose a profile to continue."} Your role controls what you can see and do.
            </p>
          </div>
        </div>

        {offline && (
          <p role="status" className="mb-4 text-center text-xs text-amber-600">The backend is unreachable — showing local profiles. Server features stay locked until it's back.</p>
        )}
        {foreignServer && (
          <p role="status" className="mb-4 text-center text-xs text-amber-600">This server is already registered to a different household — profiles marked “On this device” exist only in this browser.</p>
        )}

        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
          {members.map((m, i) => (
            <Card key={m.id} className="card-pad flex flex-col items-center text-center" hover onClick={() => void choose(m)}>
              <span style={{ ["--i" as string]: i }} className="flex flex-col items-center">
                <Avatar initials={m.initials} color={m.avatarColor} size={48} />
                <p className="font-display mt-2.5 truncate text-base font-semibold text-ink-900">{m.displayName}</p>
                <p className="text-xs font-medium text-ink-500">{m.role}</p>
                {/* Only claim a PIN is required when the server itself said so — offline or
                    locally-derived rows can't actually be checked against anything, so
                    guessing "may need PIN" was misleading. Local-only rows instead say so
                    plainly (T-03) rather than being silently indistinguishable from the
                    server's real roster. */}
                {m.origin === "server" && m.pinRequired && <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-ink-400"><Icon name="Lock" size={10} /> PIN required</span>}
                {m.origin === "local" && foreignServer && <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-amber-600"><Icon name="Laptop" size={10} /> On this device — not registered with this server</span>}
              </span>
            </Card>
          ))}
        </div>

        {pinFor && (
          <Card className="card-pad mx-auto mt-5 max-w-sm animate-slide-up">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-800"><Icon name="Lock" size={15} className="text-lavender-600" /> Enter owner PIN for {members.find((m) => m.id === pinFor)?.displayName}</p>
            <Field label="Owner PIN">
              <TextInput type="password" value={pin} autoFocus placeholder="••••" onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { const p = members.find((m) => m.id === pinFor); if (e.key === "Enter" && p) void choose(p); }} />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button variant="ember" disabled={authBusy || !pin} onClick={() => { const p = members.find((m) => m.id === pinFor); if (p) void choose(p); }}><Icon name="LogIn" size={16} /> Sign in</Button>
              <Button variant="ghost" onClick={() => { setPinFor(null); setPin(""); }}>Cancel</Button>
            </div>
          </Card>
        )}

        {/* ───────────── Email identity: your own household on this server ───────────── */}
        {!emailMode ? (
          <p className="mt-6 text-center text-sm text-ink-500">
            Not part of this household?{" "}
            <button className="font-semibold text-ember-600 underline-offset-2 hover:underline" onClick={() => setEmailMode("signin")}>Sign in with email</button>
            {" · "}
            <button className="font-semibold text-ember-600 underline-offset-2 hover:underline" onClick={() => setEmailMode("create")}>Create or join a household</button>
          </p>
        ) : (
          <Card className="card-pad mx-auto mt-6 max-w-sm animate-slide-up">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                <Icon name={emailMode === "signin" ? "LogIn" : "House"} size={15} className="text-ember-600" />
                {emailMode === "signin" ? "Sign in with email" : inviteToken ? "Join a household" : "Create your household"}
              </p>
              <button className="text-xs text-ink-400 hover:text-ink-600" onClick={() => setEmailMode(emailMode === "signin" ? "create" : "signin")}>
                {emailMode === "signin" ? "New here?" : "Have an account?"}
              </button>
            </div>
            {emailMode === "create" && (
              <>
                <Field label="Your name">
                  <TextInput value={ownerName} placeholder="e.g. Jordan" onChange={(e) => setOwnerName(e.target.value)} />
                </Field>
                <Field label="Invite code (optional)">
                  <TextInput value={inviteToken} placeholder="Paste a code to join an existing household" onChange={(e) => setInviteToken(e.target.value)} />
                </Field>
                {invitePreview ? (
                  <p className="mb-2 text-xs text-sage-700">Joining <strong>{invitePreview.householdName ?? "a household"}</strong> as {invitePreview.role}.</p>
                ) : inviteToken.trim() ? (
                  <p className="mb-2 text-xs text-amber-600">That code doesn't look valid — check it or leave it blank to start fresh.</p>
                ) : (
                  <Field label="Household name (optional)">
                    <TextInput value={newHouseholdName} placeholder="e.g. The Jordans" onChange={(e) => setNewHouseholdName(e.target.value)} />
                  </Field>
                )}
              </>
            )}
            {emailMode === "signin" && needPasswordFor && (
              <p className="mb-2 text-xs text-sage-700">Enter {needPasswordFor}'s email and password to continue.</p>
            )}
            <Field label="Email">
              <TextInput type="email" value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <TextInput type="password" value={password} placeholder="At least 8 characters" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitEmail(); }} />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button variant="ember" disabled={authBusy || !email.trim() || password.length < 8 || (emailMode === "create" && !ownerName.trim())} onClick={() => void submitEmail()}>
                <Icon name={emailMode === "signin" ? "LogIn" : "Sparkles"} size={16} />
                {emailMode === "signin" ? "Sign in" : inviteToken.trim() ? "Join household" : "Create household"}
              </Button>
              <Button variant="ghost" onClick={() => setEmailMode(null)}>Cancel</Button>
            </div>
            {emailMode === "create" && !inviteToken.trim() && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">Your household gets its own private space on this server — completely separate from every other family's.</p>
            )}
          </Card>
        )}

        <p className="mt-8 text-center text-xs text-ink-400">{owner ? `Owner: ${owner.displayName}. ` : ""}A profile session is required to use connectors and approve actions.</p>
        <p className="mt-2 text-center text-xs text-ink-400">
          <a href="/privacy.html" className="underline hover:text-ink-600">Privacy Policy</a>
          <span aria-hidden="true"> · </span>
          <a href="/terms.html" className="underline hover:text-ink-600">SMS Terms &amp; Conditions</a>
        </p>
      </div>
    </div>
  );
}
