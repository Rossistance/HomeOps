// "What <Name> can see" — the Owner's narrowing of a Limited Member's calendar (ADR-005).
//
// One row per other member: All / None / Some. Some opens that member's own calendars (from
// the subscriptions legend, which every viewer gets) plus "Added in FamiliOS" (the "app"
// pseudo-calendar: events made in the app rather than synced in). Everything on All is the
// same as no scope at all, so it is saved as null. The server is the judge — this only sends
// the Owner's choice and shows its sentence if it says no. Their own events, and events they
// take part in, always show whatever is chosen here.
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { api, type CalendarScope, type CalendarScopeRule, type CalendarSubscription, type MemberRec } from "@/lib/api";
import { useTheme, tapHaptic } from "@/theme";
import { Button, Chip, ChipRow, Notice, T } from "@/components/ui";
import { MemberAvatar } from "@/app/(home)/profile";

type Choice = "all" | "none" | "some";
const APP = "app";

function choiceOf(rule: CalendarScopeRule | undefined): Choice {
  if (rule === "none") return "none";
  if (rule && typeof rule === "object") return "some";
  return "all";
}

export function ScopeEditor({ member, members, subscriptions, onSaved }: {
  /** The Limited Member whose view this narrows. Their calendarScope is only sent to the Owner. */
  member: MemberRec;
  /** The household roster (api.members()). */
  members: MemberRec[];
  /** The calendars legend; fetched here when the caller doesn't have it. */
  subscriptions?: CalendarSubscription[];
  onSaved?: (scope: CalendarScope | null) => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const [subs, setSubs] = useState<CalendarSubscription[]>(subscriptions ?? []);
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const first = member.displayName.split(" ")[0];
  const others = useMemo(() => members.filter((m) => m.actorId !== member.actorId), [members, member.actorId]);

  useEffect(() => {
    if (subscriptions) { setSubs(subscriptions); return; }
    let cancelled = false;
    void api.calendarConnections().then((r) => { if (!cancelled) setSubs(r.subscriptions); });
    return () => { cancelled = true; };
  }, [subscriptions]);

  // Start from what the server has for them. Re-seeded when a different member is opened.
  useEffect(() => {
    const rules = member.calendarScope?.members ?? {};
    const c: Record<string, Choice> = {};
    const p: Record<string, string[]> = {};
    for (const [id, rule] of Object.entries(rules)) {
      c[id] = choiceOf(rule);
      if (rule && typeof rule === "object") p[id] = [...rule.calendars];
    }
    setChoice(c); setPicked(p); setNote(null);
  }, [member.actorId, member.calendarScope]);

  const setRule = (id: string, next: Choice) => {
    setChoice((c) => ({ ...c, [id]: next }));
    // "Some" with nothing ticked would read as "None" — start it with the family's own events.
    if (next === "some" && !(picked[id]?.length)) setPicked((p) => ({ ...p, [id]: [APP] }));
  };
  const toggleCal = (id: string, calId: string) => setPicked((p) => {
    const cur = p[id] ?? [];
    return { ...p, [id]: cur.includes(calId) ? cur.filter((x) => x !== calId) : [...cur, calId] };
  });

  const save = async () => {
    const rules: Record<string, CalendarScopeRule> = {};
    for (const m of others) {
      const c = choice[m.actorId] ?? "all";
      if (c === "none") rules[m.actorId] = "none";
      // Only ids still drawn as chips: a calendar removed or handed to someone else since would
      // make the server refuse the whole save, and the Owner could not see why or fix it.
      else if (c === "some") rules[m.actorId] = { calendars: (picked[m.actorId] ?? []).filter((cal) => cal === APP || subs.some((s) => s.id === cal && s.ownerActorId === m.actorId)) };
    }
    const scope: CalendarScope | null = Object.keys(rules).length ? { members: rules } : null;
    setBusy(true); setNote(null);
    const r = await api.setCalendarScope(member.actorId, scope);
    setBusy(false);
    if (r.error) {
      tapHaptic("error");
      setNote({ text: r.message ?? (r.error === "network" ? "Couldn't reach the server. Try again." : "Couldn't save that."), ok: false });
      return;
    }
    tapHaptic("success");
    setNote({ text: scope ? `Saved. ${first}'s calendar shows what you picked.` : `Saved. ${first} sees the whole family calendar.`, ok: true });
    onSaved?.(r.member?.calendarScope ?? scope);
  };

  return (
    <View testID="scope-editor" style={{ gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <T kind="eyebrow">What {first} can see</T>
        <T kind="sub">Their own events, and ones they're part of, always show.</T>
      </View>
      {others.length === 0 ? <T kind="detail">No one else in the household yet.</T> : null}
      {others.map((m) => {
        const c = choice[m.actorId] ?? "all";
        const name = m.displayName.split(" ")[0];
        const theirs = subs.filter((s) => s.ownerActorId === m.actorId);
        const sel = picked[m.actorId] ?? [];
        return (
          <View
            key={m.actorId}
            testID={`scope-member-${m.actorId}`}
            style={{ gap: spacing.sm, backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous", padding: spacing.md }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <MemberAvatar member={m} size={28} ringWidth={1.5} />
              <T kind="bodyMedium" color={colors.text} style={{ flex: 1 }} numberOfLines={1}>{m.displayName}</T>
            </View>
            <ChipRow>
              {(["all", "none", "some"] as const).map((k) => (
                <Chip
                  key={k}
                  label={k === "all" ? "All" : k === "none" ? "None" : "Some"}
                  selected={c === k}
                  onPress={() => setRule(m.actorId, k)}
                  accessibilityLabel={`${first} sees ${k === "all" ? "all" : k === "none" ? "none" : "some"} of ${name}'s events`}
                />
              ))}
            </ChipRow>
            {c === "some" ? (
              <View style={{ gap: 6 }}>
                <T kind="detail">Which of {name}'s calendars</T>
                <ChipRow>
                  {theirs.map((s) => (
                    <Chip
                      key={s.id}
                      label={s.name}
                      icon={sel.includes(s.id) ? "checkmark" : "calendar"}
                      selected={sel.includes(s.id)}
                      onPress={() => toggleCal(m.actorId, s.id)}
                      accessibilityLabel={`${s.name}, ${sel.includes(s.id) ? "shown" : "not shown"} to ${first}`}
                    />
                  ))}
                  <Chip
                    label="Added in FamiliOS"
                    icon={sel.includes(APP) ? "checkmark" : "house"}
                    selected={sel.includes(APP)}
                    onPress={() => toggleCal(m.actorId, APP)}
                    accessibilityLabel={`${name}'s events added in FamiliOS, ${sel.includes(APP) ? "shown" : "not shown"} to ${first}`}
                  />
                </ChipRow>
                {theirs.length === 0 ? <T kind="detail" color={colors.textFaint}>{name} has no connected calendars yet.</T> : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {note ? <Notice text={note.text} ok={note.ok} /> : null}
      <Button
        title={busy ? "Saving…" : `Save what ${first} sees`}
        variant="neutral" icon="eye" full loading={busy}
        onPress={() => void save()}
        testID="scope-editor-save"
      />
    </View>
  );
}
