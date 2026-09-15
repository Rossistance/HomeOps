// Nests — a small group inside the household.
//
// "GPop and Beannie are actually married. So for them it might make sense to keep their own
//  helpers and grocery list and task list available between the two of them, and yet still
//  isolated from the broader family group… there should be some way to associate two profiles…
//  there should be a way to say 'send an invite to create a nest'… and the other person would
//  approve — you can either join or decline… and be able to leave that nest at any point."
//
// The screen is deliberately plain about the two things that make a nest trustworthy: who can
// see inside it (only the people in it — not the household's Owner), and that you can walk out
// whenever you like. Both are enforced on the server; this says so out loud, because a private
// space you have to take on faith isn't one.
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, type MemberRec, type NestRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import { memberColor } from "@/lib/member-colors";
import {
  T, Button, Card, Chip, ChipRow, EmptyState, ExpandCard, HScreen, Notice,
  PressableScale, Rise, SectionHeader, SkeletonCards, Sym,
} from "@/components/ui";

export default function NestsScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nests, setNests] = useState<NestRec[]>([]);
  const [invitations, setInvitations] = useState<NestRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const [n, ms] = await Promise.all([api.nests(), api.members()]);
    setNests(n.nests);
    setInvitations(n.invitations);
    setMembers(ms.filter((m) => m.actorId !== session?.actorId));
    setLoading(false);
  }, [session?.actorId]);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const create = async () => {
    if (picked.length === 0) return;
    setBusy("create"); setNotice(null);
    const r = await api.createNest(picked);
    setBusy(null);
    if (!r.nest) {
      setNotice({ text: r.message ?? "Couldn't create that nest.", ok: false });
      return;
    }
    tapHaptic("success");
    setPicked([]);
    // Say what happens next. An invite that silently waits is indistinguishable from nothing.
    const names = picked.map((id) => members.find((m) => m.actorId === id)?.displayName.split(" ")[0]).filter(Boolean);
    setNotice({ text: `Invited ${names.join(" and ")}. It becomes a shared space once they accept.`, ok: true });
    await load();
  };

  const respond = async (n: NestRec, action: "accept" | "decline" | "leave") => {
    setBusy(`${action}:${n.id}`); setNotice(null);
    const r = await api.nestAction(n.id, action);
    setBusy(null);
    if (r.error) {
      setNotice({ text: r.message ?? "Couldn't do that.", ok: false });
      return;
    }
    tapHaptic(action === "decline" || action === "leave" ? "light" : "success");
    setNotice({
      ok: true,
      text: action === "accept" ? `You're in ${n.label}.`
        : action === "decline" ? "Declined — nothing was shared."
        : r.archived ? `You left ${n.label}. Nobody's left in it, so it's been archived — nothing was deleted.`
        : `You left ${n.label}. What you made in it stays for the others.`,
    });
    await load();
  };

  const confirmLeave = (n: NestRec) => {
    Alert.alert(
      `Leave ${n.label}?`,
      "You'll stop seeing its chats and lists. Anything you made in it stays with whoever is left — nothing is deleted.",
      [{ text: "Cancel", style: "cancel" }, { text: "Leave", style: "destructive", onPress: () => void respond(n, "leave") }],
    );
  };

  const toneFor = (actorId: string) => memberColor(colors, members.find((m) => m.actorId === actorId)) ?? colors.lavender;

  if (loading) return <HScreen><SkeletonCards count={3} /></HScreen>;

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      <Rise index={0}>
        <T kind="sub">
          A nest is a small group inside your household — a shared space for chats, lists and
          helpers that the rest of the family doesn&apos;t see. Everyone stays a full member of the
          household; this is just somewhere of your own.
        </T>
      </Rise>

      {/* An invitation is the first thing you should see, because it's waiting on you. */}
      {invitations.length > 0 ? (
        <Rise index={1}>
          <SectionHeader title={invitations.length === 1 ? "An invitation" : "Invitations"} />
          <View style={{ gap: spacing.sm }}>
            {invitations.map((n) => (
              <Card key={n.id} style={{ gap: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.ember }}>
                <View style={{ gap: 2 }}>
                  <T kind="h3" color={colors.text}>{n.label}</T>
                  <T kind="sub">
                    {(n.members.find((m) => m.actorId === n.createdBy)?.name) ?? "Someone"} invited you.
                    Only the people in it can see what&apos;s inside — not even the household&apos;s owner.
                  </T>
                </View>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button small variant="ember" icon="checkmark" full title="Join" loading={busy === `accept:${n.id}`} onPress={() => void respond(n, "accept")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button small variant="neutral" full title="Decline" loading={busy === `decline:${n.id}`} onPress={() => void respond(n, "decline")} />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        </Rise>
      ) : null}

      <Rise index={2}>
        <SectionHeader title={nests.length === 1 ? "Your nest" : "Your nests"} />
        {nests.length === 0 ? (
          <EmptyState
            icon="person.2"
            title="No nests yet"
            hint="Pick someone below to share a space with. They'll get an invitation to accept or decline."
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {nests.map((n) => {
              const joined = n.members.filter((m) => m.status === "joined");
              const waiting = n.members.filter((m) => m.status === "invited");
              return (
                <ExpandCard
                  key={n.id}
                  title={n.label}
                  icon="person.2.fill"
                  iconColor={colors.lavender}
                  iconBg={colors.lavenderBg}
                  summary="Chats, lists and helpers here stay between the people in this nest."
                  chips={[
                    { label: `${joined.length} in`, icon: "person.2", tone: "good" },
                    ...(waiting.length ? [{ label: `${waiting.length} not answered`, icon: "clock", tone: "warn" as const }] : []),
                  ]}
                  action={{ label: "Leave", icon: "rectangle.portrait.and.arrow.right", variant: "ghost", onPress: () => confirmLeave(n) }}
                >
                  <View style={{ gap: 6 }}>
                    {n.members.map((m) => (
                      <View key={m.actorId} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: toneFor(m.actorId) }} />
                        <T kind="sub" style={{ flex: 1 }}>{m.name ?? m.actorId}</T>
                        <T kind="caption" color={m.status === "joined" ? colors.sage : m.status === "invited" ? colors.amber : colors.textFaint}>
                          {m.status === "joined" ? "in" : m.status === "invited" ? "hasn't answered" : m.status}
                        </T>
                      </View>
                    ))}
                  </View>
                </ExpandCard>
              );
            })}
          </View>
        )}
      </Rise>

      {members.length > 0 ? (
        <Rise index={3}>
          <SectionHeader title="Start a nest" />
          <Card style={{ gap: spacing.md }}>
            <T kind="sub">Who do you want to share a space with?</T>
            <ChipRow>
              {members.map((m) => (
                <Chip
                  key={m.actorId}
                  label={m.displayName.split(" ")[0]}
                  icon={picked.includes(m.actorId) ? "checkmark" : "person"}
                  selected={picked.includes(m.actorId)}
                  onPress={() => setPicked((p) => (p.includes(m.actorId) ? p.filter((x) => x !== m.actorId) : [...p, m.actorId]))}
                />
              ))}
            </ChipRow>
            <Button
              variant="ember" full icon="paperplane.fill"
              title={picked.length === 0 ? "Pick someone first" : `Send ${picked.length === 1 ? "an invite" : `${picked.length} invites`}`}
              disabled={picked.length === 0 || busy === "create"}
              loading={busy === "create"}
              onPress={() => void create()}
            />
            <T kind="caption" color={colors.textFaint}>
              They decide — an invitation can be declined, and anyone can leave a nest later.
            </T>
          </Card>
        </Rise>
      ) : null}
    </HScreen>
  );
}
