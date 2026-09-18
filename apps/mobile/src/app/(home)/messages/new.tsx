// New message / Add people: the household, grouped Adults and Kids, showing only the people a
// request would succeed for (the server decides for real). Pick one for a direct thread, more
// for a group; in add mode (`?threadId=`) picks join an existing chat.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { api, type MemberRec, type NestRec, type ThreadRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { canStartWith } from "@/lib/messages";
import { memberTone } from "@/lib/member-colors";
import { useTheme, tapHaptic } from "@/theme";
import { T, Card, Button, HScreen, SectionHeader, EmptyState, SkeletonCards, PressableScale, Sym, Rise } from "@/components/ui";

const CHILD = new Set(["Child View", "Limited Member"]);

export default function NewMessageScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const params = useLocalSearchParams<{ threadId?: string }>();
  const addMode = typeof params.threadId === "string" && !!params.threadId;
  const [members, setMembers] = useState<MemberRec[] | null>(null);
  const [nests, setNests] = useState<NestRec[]>([]);
  const [thread, setThread] = useState<ThreadRec | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ms, ns, tv] = await Promise.all([api.members(), api.nests(), addMode ? api.thread(params.threadId!) : Promise.resolve(null)]);
    setMembers(ms); setNests(ns.nests); setThread(tv?.thread ?? null);
  }, [addMode, params.threadId]);
  useEffect(() => { if (session) void load(); }, [session, load]);

  const me = useMemo(() => members?.find((m) => m.isCurrentUser) ?? members?.find((m) => m.actorId === session?.actorId) ?? null, [members, session]);
  const already = useMemo(() => new Set(thread?.members.filter((m) => !m.leftAt).map((m) => m.actorId) ?? []), [thread]);
  const eligible = useMemo(() => (members ?? []).filter((m) => canStartWith(me, m, nests) && !already.has(m.actorId)), [members, me, nests, already]);
  const adults = eligible.filter((m) => !CHILD.has(m.role));
  const kids = eligible.filter((m) => CHILD.has(m.role));

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function go() {
    if (picked.size === 0) return;
    setBusy(true);
    if (addMode && params.threadId) {
      for (const id of picked) {
        const r = await api.addThreadMember(params.threadId, id);
        if (r.error) { setBusy(false); tapHaptic("error"); Alert.alert("Couldn't add them", r.message ?? (r.whoName ? `${r.whoName} can't be added to this chat.` : r.error)); return; }
      }
      tapHaptic("success");
      router.back();
      return;
    }
    const r = await api.createThread([...picked]);
    setBusy(false);
    if (!r.thread) { tapHaptic("error"); Alert.alert("Couldn't start that chat", r.whoName ? `You can't message ${r.whoName}.` : r.error ?? "Something went wrong."); return; }
    tapHaptic("success");
    router.replace({ pathname: "/messages/[id]", params: { id: r.thread.id } } as never);
  }

  const Row = ({ m, last }: { m: MemberRec; last: boolean }) => {
    const on = picked.has(m.actorId);
    const tone = memberTone(colors, m);
    return (
      <PressableScale
        onPress={() => toggle(m.actorId)}
        haptic="select"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={`${m.displayName}, ${m.role}`}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}
      >
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: tone.bg, borderWidth: 1.5, borderColor: tone.fg, alignItems: "center", justifyContent: "center" }}>
          <T kind="subMedium" color={tone.fg}>{m.displayName.slice(0, 1)}</T>
        </View>
        <View style={{ flex: 1 }}>
          <T kind="bodyMedium" color={colors.text}>{m.displayName}</T>
          <T kind="caption" color={colors.textMuted}>{m.relationship ?? m.role}</T>
        </View>
        <Sym name={on ? "checkmark.circle.fill" : "circle"} size={22} color={on ? colors.ember : colors.textFaint} />
      </PressableScale>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: addMode ? "Add people" : "New message" }} />
      <HScreen>
        {!members ? <SkeletonCards count={2} /> : eligible.length === 0 ? (
          <Rise index={1}><EmptyState icon="person.2" title={addMode ? "Nobody else to add" : "Nobody to message"} hint={me && CHILD.has(me.role) ? "Chats come to you from a parent; you can reply in any you're in." : "Everyone you can message is already here."} /></Rise>
        ) : (
          <>
            {adults.length ? (
              <Rise index={1}>
                <SectionHeader title="Adults" />
                <Card padded={false}>{adults.map((m, i) => <Row key={m.actorId} m={m} last={i === adults.length - 1} />)}</Card>
              </Rise>
            ) : null}
            {kids.length ? (
              <Rise index={2}>
                <SectionHeader title="Kids" />
                <Card padded={false}>{kids.map((m, i) => <Row key={m.actorId} m={m} last={i === kids.length - 1} />)}</Card>
              </Rise>
            ) : null}
            <Rise index={3}>
              <Button
                title={addMode ? (picked.size > 1 ? `Add ${picked.size} people` : "Add to chat") : picked.size > 1 ? `Start group of ${picked.size + 1}` : "Start chat"}
                variant="ember" icon={addMode ? "person.badge.plus" : "paperplane"} full loading={busy} disabled={picked.size === 0} onPress={() => void go()}
              />
              {!addMode && picked.size <= 1 ? <T kind="caption" color={colors.textMuted} center style={{ marginTop: 8 }}>Pick more than one person for a group. You can add people later too.</T> : null}
            </Rise>
          </>
        )}
      </HScreen>
    </>
  );
}
