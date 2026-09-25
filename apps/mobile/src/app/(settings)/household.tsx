// Household & Spaces — the roster (server-owned roles), how visibility really
// works, and which space each of your visible items belongs to. Display-only:
// everything shown is exactly what the server enforces.
import { useCallback, useEffect, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { api, type AppSettingsRec, type Autonomy, type EventRec, type FileRec, type Meal, type MemberRec, type TaskRec } from "@/lib/api";
import { fade, memberColor } from "@/lib/member-colors";
import { isBlock } from "@/lib/event-face";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, type HearthColors } from "@/theme";
import { Badge, Button, Card, EmptyState, ErrorState, HScreen, Notice, PinPrompt, PressableCard, Rise, SectionHeader, SkeletonCards, Sym, T, Well } from "@/components/ui";

function roleTone(c: HearthColors, role: string): { fg: string; bg: string } {
  switch (role) {
    case "Owner": case "Adult Admin": return { fg: c.ember, bg: c.emberBg };
    case "Adult Member": return { fg: c.sage, bg: c.sageBg };
    case "Limited Member": return { fg: c.sky, bg: c.skyBg };
    case "Child View": return { fg: c.lavender, bg: c.lavenderBg };
    default: return { fg: c.textMuted, bg: c.surfaceSunken };
  }
}

const spaceLabel = (id: string) => {
  const raw = id.replace(/^sp-/, "").replace(/[-_]/g, " ");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

/* THE ONE QUESTION.
 *
 * Every other autonomy control is per-helper or per-tool, and both are advanced. A family that
 * just wants the thing to work had two options: answer an approval for every reminder, or go
 * learn a capability matrix on the web app. So they got the nagging — which was never a
 * decision anyone made, just the absence of one. This is the decision, on the surface the
 * family actually uses.
 *
 * It writes ONE value. The stances are enforced in server/policy.mjs rule 7 and nowhere else —
 * no bulk-writing of per-helper flags, which would fight with settings someone made
 * deliberately and rewrite records every time the preset changed. */
const STANCES: { key: Autonomy; title: string; blurb: string; note: string; icon: string }[] = [
  { key: "Cautious", icon: "checkmark.shield.fill", title: "Cautious", blurb: "Ask me about everything that isn't just reading.", note: "The most approvals. Good for a while, if you want to watch each step." },
  { key: "Balanced", icon: "scalemass.fill", title: "Balanced", blurb: "Handle everyday things here at home; ask before anything goes out.", note: "Tasks, notes, lists and calendar entries just happen. Email, texts, purchases and anything reaching another service still ask." },
  { key: "Trusted", icon: "bolt.fill", title: "Trusted", blurb: "Also send and spend without asking me first.", note: "Needs your household PIN. The pause switch still stops everything, and any step marked “always ask” still waits." },
];

function AutonomyPicker({ settings, colors, onSaved }: { settings: AppSettingsRec; colors: HearthColors; onSaved: (s: AppSettingsRec) => void }) {
  const { spacing } = useTheme();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Autonomy | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const current: Autonomy = settings.autonomy ?? "Cautious";
  const unanswered = settings.autonomyDefaulted !== false;

  const apply = async (stance: Autonomy, pin?: string) => {
    setBusy(true);
    const r = await api.updateSettings({ autonomy: stance, ...(pin ? { pin } : {}) });
    setBusy(false);
    if (!r.settings) {
      // pin_required and pin_incorrect are QUESTIONS, not failures — ask, don't report.
      if (r.error === "pin_required" || r.error === "pin_incorrect") {
        setPending(stance);
        setPinErr(r.error === "pin_incorrect" ? (r.message ?? "That PIN didn't match. Nothing was changed.") : null);
        return;
      }
      setNote(r.message ?? (r.error === "insufficient_role" ? "Only an Owner or Adult Admin can change this." : "Couldn't change that."));
      return;
    }
    tapHaptic("success");
    setPending(null); setPinErr(null); setNote(null);
    onSaved(r.settings);
  };

  return (
    <>
      <SectionHeader title="How much should FamiliOS do on its own?" />
      <Card style={{ gap: spacing.sm }}>
        <T kind="sub">One answer for the whole family. You can still change it for any single helper or tool — those choices win over this one.</T>
        {unanswered && <Notice ok={false} tone={{ fg: colors.amber, bg: colors.amberBg }} text="Nobody has answered this yet, so FamiliOS is asking about everything. Balanced is what most families want." />}
        {STANCES.map((s) => {
          const on = current === s.key;
          return (
            <PressableCard
              key={s.key}
              disabled={busy}
              onPress={() => { tapHaptic(); void apply(s.key); }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: busy }}
              accessibilityLabel={`${s.title}. ${s.blurb}`}
              style={{
                borderColor: on ? colors.sage : colors.border,
                backgroundColor: on ? colors.sageBg : colors.surfaceSunken,
              }}
            >
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Sym name={s.icon} size={16} color={on ? colors.sage : colors.textFaint} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <T kind="rowTitle">{s.title}</T>
                    {on && <Badge label="current" fg={colors.sage} bg={colors.sageBg} />}
                  </View>
                  <T kind="sub">{s.blurb}</T>
                  <T kind="caption" color={colors.textFaint}>{s.note}</T>
                </View>
              </View>
            </PressableCard>
          );
        })}
        {current === "Trusted" && settings.autonomySetByRole ? (
          <T kind="caption" color={colors.textFaint}>Allowed by an {settings.autonomySetByRole}.</T>
        ) : null}
        {note ? <Notice ok={false} text={note} /> : null}
      </Card>

      <PinPrompt
        visible={!!pending}
        title="Confirm with your household PIN"
        warning="You're allowing your family's helpers to send messages and spend money without asking first. The pause switch still stops everything, and any step you've marked “always ask” still waits. You can come back to Balanced at any time without the PIN."
        busy={busy}
        error={pinErr}
        onCancel={() => { setPending(null); setPinErr(null); }}
        onConfirm={(pin) => void apply(pending!, pin)}
      />
    </>
  );
}

type SpaceItem = { kind: "event" | "task" | "meal" | "file"; title: string };

const KIND_ICON: Record<SpaceItem["kind"], string> = {
  event: "calendar", task: "checkmark.circle", meal: "fork.knife", file: "folder",
};

export default function HouseholdScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [files, setFiles] = useState<FileRec[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /* The sign-in PIN could only be set on the web app, which is a strange place to keep the
   * one credential that guards every Owner and Adult Admin sign-in — on a phone-first app
   * whose owner is testing on a phone. */
  const [settings, setSettings] = useState<AppSettingsRec | null>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinNote, setPinNote] = useState<{ text: string; ok: boolean } | null>(null);
  const isAdmin = session?.role === "Owner" || session?.role === "Adult Admin";

  const load = useCallback(async () => {
    const [m, ev, tk, ml, f, st] = await Promise.all([
      api.members(), api.events(), api.tasks(), api.meals(), api.files(), api.settings().catch(() => null),
    ]);
    setMembers(m); setEvents(ev); setTasks(tk); setMeals(ml); setFiles(f); setSettings(st);
    setLoaded(true);
  }, []);

  const savePin = async () => {
    setPinNote(null);
    if (!/^\d{4,12}$/.test(pin)) { setPinNote({ text: "A PIN is 4 to 12 digits.", ok: false }); return; }
    // Typed twice, because you cannot check a PIN afterwards — only find out at the lock
    // screen that it isn't what you thought.
    if (pin !== pin2) { setPinNote({ text: "The two PINs don't match.", ok: false }); return; }
    setPinBusy(true);
    const r = await api.updateSettings({ ownerPin: pin });
    setPinBusy(false);
    if (!r.settings) {
      setPinNote({ text: r.message ?? (r.error === "insufficient_role" ? "Only an Owner or Adult Admin can set the PIN." : "Couldn't save that."), ok: false });
      return;
    }
    tapHaptic("success");
    setSettings(r.settings);
    setPin(""); setPin2("");
    setPinNote({
      ok: true,
      text: r.settings.breakGlassActive
        ? "Saved. Sign out and back in with it to check — then the recovery PIN below can be removed."
        : "Saved. Owner and Adult Admin sign-in uses this from now on.",
    });
  };
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Group everything this session can see by its spaceId. Meals carry no spaceId
  // (household-wide by design), so they group under the family space.
  const spaces = useMemo(() => {
    const map: Record<string, SpaceItem[]> = {};
    const put = (id: string | undefined, item: SpaceItem) => { (map[id || "sp-family"] ??= []).push(item); };
    // Blocks (someone else's hidden time, ADR-005) are stand-ins, not events a space holds.
    for (const e of events) if (!isBlock(e)) put(e.spaceId, { kind: "event", title: e.title });
    for (const t of tasks) put((t as TaskRec & { spaceId?: string }).spaceId, { kind: "task", title: t.title });
    for (const m of meals) put(undefined, { kind: "meal", title: m.title });
    for (const f of files) put(f.spaceId, { kind: "file", title: f.name });
    return map;
  }, [events, tasks, meals, files]);

  const kindTone: Record<SpaceItem["kind"], string> = {
    event: colors.ember, task: colors.sky, meal: colors.sage, file: colors.lavender,
  };

  if (!loaded) {
    return (
      <HScreen keyboardAware>
        <SkeletonCards count={4} />
      </HScreen>
    );
  }

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh} keyboardAware>
      {/* The household's stance, first — it's the one autonomy question most families will
          ever answer, and every other control in the product is per-helper or per-tool. */}
      {isAdmin && settings && (
        <AutonomyPicker
          settings={settings}
          colors={colors}
          onSaved={(s) => setSettings(s)}
        />
      )}
      <SectionHeader title="Members" />
      {members.length === 0 ? (
        <ErrorState message="Can't load the roster — is the backend reachable?" onRetry={() => void load()} />
      ) : (
        members.map((m, i) => {
          const rc = roleTone(colors, m.role);
          const initial = (m.displayName || "?").trim().charAt(0).toUpperCase();
          // Member accent (their picked color, or the deterministic fallback) and
          // curated emoji avatar ("emoji:🦊") — file-id photos stay initials here.
          const accent = memberColor(colors, m) ?? rc.fg;
          const emoji = m.photoFileId?.startsWith("emoji:") ? m.photoFileId.slice(6) : null;
          return (
            <Rise key={m.actorId} index={i}>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <View style={{
                    width: 44, height: 44, borderRadius: 22, backgroundColor: fade(accent, 0.16),
                    borderWidth: 1.5, borderColor: accent,
                    alignItems: "center", justifyContent: "center",
                  }}>
                    {emoji
                      ? <T style={{ fontSize: 20, lineHeight: 26 }}>{emoji}</T>
                      : <T kind="h3" color={accent}>{initial}</T>}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <T kind="bodyMedium" color={colors.text}>{m.displayName}</T>
                      {m.isCurrentUser ? <Badge label="You" fg={colors.ember} bg={colors.emberBg} /> : null}
                    </View>
                    {m.relationship ? <T kind="sub">{m.relationship}</T> : null}
                  </View>
                  <Badge label={m.role} fg={rc.fg} bg={rc.bg} />
                </View>
              </Card>
            </Rise>
          );
        })
      )}

      {isAdmin ? (
        <Rise index={1}>
          <SectionHeader title="Sign-in PIN" />
          <Card style={{ gap: spacing.md }}>
            <T kind="sub">
              Owner and Adult Admin sign-in asks for this PIN. Everyone else signs in by picking
              their profile — the PIN guards the accounts that can change the household.
            </T>

            {/* Say plainly when a deployment-level override is ALSO being accepted. It's a
                single shared secret that opens every elevated account, and there is otherwise
                no way to tell from inside the app that it's in play. */}
            {settings?.breakGlassActive ? (
              <Notice
                ok={false}
                text={settings.ownerPinSet
                  ? "A recovery PIN set on the server is also being accepted right now. It works for every Owner and Adult Admin account, not just yours. Once you've signed in with your own PIN, it should be removed from the deployment."
                  : "This household has no PIN of its own yet — elevated sign-in is currently going through a recovery PIN set on the server, which opens every Owner and Adult Admin account. Set one here."}
              />
            ) : null}

            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Sym name={settings?.ownerPinSet ? "lock.fill" : "lock.open"} size={14} color={settings?.ownerPinSet ? colors.sage : colors.amber} />
              <T kind="sub" color={settings?.ownerPinSet ? colors.sage : colors.amber}>
                {settings?.ownerPinSet ? "A PIN is set for this household" : "No PIN set for this household"}
              </T>
            </View>

            <Well style={{ padding: 0 }}>
              <TextInput
                value={pin}
                onChangeText={setPin}
                placeholder={settings?.ownerPinSet ? "New PIN (4–12 digits)" : "Choose a PIN (4–12 digits)"}
                placeholderTextColor={colors.textFaint}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={12}
                style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
                accessibilityLabel="New sign-in PIN"
              />
            </Well>
            <Well style={{ padding: 0 }}>
              <TextInput
                value={pin2}
                onChangeText={setPin2}
                placeholder="Type it again"
                placeholderTextColor={colors.textFaint}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={12}
                onSubmitEditing={() => void savePin()}
                style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
                accessibilityLabel="Confirm the new sign-in PIN"
              />
            </Well>
            {pinNote ? <Notice text={pinNote.text} ok={pinNote.ok} /> : null}
            <Button
              variant="ember" full icon="lock.fill"
              title={settings?.ownerPinSet ? "Change the PIN" : "Set the PIN"}
              disabled={!pin || !pin2 || pinBusy}
              loading={pinBusy}
              onPress={() => void savePin()}
            />
            <T kind="caption" color={colors.textFaint}>
              Nobody can read it back afterwards, including this app — only replace it. Changing
              it doesn&apos;t sign anyone out.
            </T>
          </Card>
        </Rise>
      ) : null}

      <SectionHeader title="How visibility works" />
      <Rise index={1}>
        <Card style={{ gap: 10 }}>
          <T kind="sub">These rules are enforced by the server on every request — not by this app:</T>
          {([
            { icon: "person.3", bold: "Household", rest: "items are visible to everyone in the family." },
            { icon: "lock", bold: "Adults-only", rest: "items are hidden from children and guests entirely." },
            { icon: "eye.slash", bold: "Private", rest: "items are visible only to their owner and participants." },
            { icon: "checkmark.circle", bold: "Owners and participants", rest: "always see their own items." },
          ] as const).map((r) => (
            <View key={r.icon} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
              <Sym name={r.icon} size={15} color={colors.textMuted} style={{ marginTop: 3 }} />
              <T kind="sub" style={{ flex: 1 }} color={colors.textSecondary}>
                <T kind="subMedium" color={colors.text}>{r.bold}</T> {r.rest}
              </T>
            </View>
          ))}
          <T kind="caption" color={colors.textFaint}>
            You're signed in as {session?.role} — everything on this screen already reflects what that role can see.
          </T>
        </Card>
      </Rise>

      <SectionHeader title="Spaces" />
      <Rise index={2}>
        <T kind="sub">Every item you can see, grouped by the space it belongs to.</T>
      </Rise>
      {Object.keys(spaces).length === 0 ? (
        <EmptyState icon="square.grid.2x2" title="No items yet" hint="The calendar, tasks, meals, and files you can see will group here." />
      ) : (
        Object.keys(spaces).sort().map((sid, i) => (
          <Rise key={sid} index={Math.min(i + 3, 8)}>
            <Card style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                <T kind="h3" color={colors.text}>{spaceLabel(sid)}</T>
                <Badge label={`${spaces[sid].length} item${spaces[sid].length === 1 ? "" : "s"}`} fg={colors.textMuted} bg={colors.surfaceSunken} />
              </View>
              <View style={{ gap: 6 }}>
                {spaces[sid].slice(0, 12).map((it, j) => (
                  <View key={j} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Sym name={KIND_ICON[it.kind]} size={14} color={kindTone[it.kind]} />
                    <T kind="sub" style={{ flex: 1 }} numberOfLines={1}>{it.title}</T>
                    <T kind="caption" color={colors.textFaint}>{it.kind}</T>
                  </View>
                ))}
                {spaces[sid].length > 12 ? (
                  <T kind="caption" color={colors.textFaint}>…and {spaces[sid].length - 12} more</T>
                ) : null}
              </View>
            </Card>
          </Rise>
        ))
      )}
    </HScreen>
  );
}
