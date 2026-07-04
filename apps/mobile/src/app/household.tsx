import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { api, type EventRec, type FileRec, type Meal, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Household & Spaces — the roster (server-owned roles), how visibility really
// works, and which space each of your visible items belongs to. Display-only:
// everything shown is exactly what the server enforces.
const ROLE_COLORS: Record<string, { color: string; bg: string }> = {
  "Owner": { color: Hearth.ember600, bg: Hearth.ember50 },
  "Adult Admin": { color: Hearth.ember600, bg: Hearth.ember50 },
  "Adult Member": { color: Hearth.sage600, bg: Hearth.sageBg },
  "Limited Member": { color: Hearth.sky500, bg: Hearth.skyBg },
  "Child View": { color: Hearth.lavender500, bg: Hearth.lavenderBg },
  "Guest/Helper": { color: Hearth.ink500, bg: Hearth.surfaceSunken },
};

const spaceLabel = (id: string) => {
  const raw = id.replace(/^sp-/, "").replace(/[-_]/g, " ");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

type SpaceItem = { kind: "event" | "task" | "meal" | "file"; title: string };

export default function HouseholdScreen() {
  const { session } = useSession();
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [files, setFiles] = useState<FileRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [m, ev, tk, ml, f] = await Promise.all([api.members(), api.events(), api.tasks(), api.meals(), api.files()]);
    setMembers(m); setEvents(ev); setTasks(tk); setMeals(ml); setFiles(f);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Group everything this session can see by its spaceId. Meals carry no spaceId
  // (household-wide by design), so they group under the family space.
  const spaces = useMemo(() => {
    const map: Record<string, SpaceItem[]> = {};
    const put = (id: string | undefined, item: SpaceItem) => { (map[id || "sp-family"] ??= []).push(item); };
    for (const e of events) put((e as EventRec & { spaceId?: string }).spaceId, { kind: "event", title: e.title });
    for (const t of tasks) put((t as TaskRec & { spaceId?: string }).spaceId, { kind: "task", title: t.title });
    for (const m of meals) put(undefined, { kind: "meal", title: m.title });
    for (const f of files) put(f.spaceId, { kind: "file", title: f.name });
    return map;
  }, [events, tasks, meals, files]);

  const kindIconColor: Record<SpaceItem["kind"], string> = { event: Hearth.ember500, task: Hearth.sky500, meal: Hearth.sage600, file: Hearth.lavender500 };

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <H1>Household</H1>
        <Muted style={{ marginTop: 4 }}>Who's in the family, what they can see, and where things live.</Muted>

        <View style={{ marginTop: 20 }}><Eyebrow>Members</Eyebrow></View>
        {members.map((m) => {
          const rc = ROLE_COLORS[m.role] ?? { color: Hearth.ink500, bg: Hearth.surfaceSunken };
          return (
            <Card key={m.actorId} style={{ marginTop: 8 }}>
              <View style={st.between}>
                <View style={{ flex: 1 }}>
                  <View style={st.row}>
                    <Body style={{ fontWeight: "600" }}>{m.displayName}</Body>
                    {m.isCurrentUser && <Badge label="You" color={Hearth.ember600} bg={Hearth.ember50} />}
                  </View>
                  {m.relationship ? <Muted style={{ fontSize: 12, marginTop: 2 }}>{m.relationship}</Muted> : null}
                </View>
                <Badge label={m.role} color={rc.color} bg={rc.bg} />
              </View>
            </Card>
          );
        })}
        {members.length === 0 && <Card style={{ marginTop: 8 }}><Muted>Can&apos;t load the roster — is the backend reachable?</Muted></Card>}

        <View style={{ marginTop: 20 }}><Eyebrow>How visibility works</Eyebrow></View>
        <Card style={{ marginTop: 8, gap: 6 }}>
          <Muted style={{ fontSize: 13 }}>These rules are enforced by the server on every request — not by this app:</Muted>
          <Body style={{ fontSize: 13 }}>• <Body style={{ fontWeight: "600", fontSize: 13 }}>Household</Body> items are visible to everyone in the family.</Body>
          <Body style={{ fontSize: 13 }}>• <Body style={{ fontWeight: "600", fontSize: 13 }}>Adults-only</Body> items are hidden from children and guests entirely.</Body>
          <Body style={{ fontSize: 13 }}>• <Body style={{ fontWeight: "600", fontSize: 13 }}>Private</Body> items are visible only to their owner and participants.</Body>
          <Body style={{ fontSize: 13 }}>• Owners and participants always see their own items.</Body>
          <Muted style={{ fontSize: 12, marginTop: 2 }}>You&apos;re signed in as {session?.role} — this list already reflects what that role can see.</Muted>
        </Card>

        <View style={{ marginTop: 20 }}><Eyebrow>Spaces</Eyebrow></View>
        <Muted style={{ marginTop: 4, fontSize: 12 }}>Every item you can see, grouped by the space it belongs to.</Muted>
        {Object.keys(spaces).sort().map((sid) => (
          <Card key={sid} style={{ marginTop: 8 }}>
            <View style={st.row}>
              <Body style={{ fontWeight: "600" }}>{spaceLabel(sid)}</Body>
              <Badge label={`${spaces[sid].length} item${spaces[sid].length === 1 ? "" : "s"}`} color={Hearth.ink500} bg={Hearth.surfaceSunken} />
            </View>
            <View style={{ marginTop: 8, gap: 4 }}>
              {spaces[sid].slice(0, 12).map((it, i) => (
                <View key={i} style={st.itemRow}>
                  <View style={[st.dot, { backgroundColor: kindIconColor[it.kind] }]} />
                  <Muted style={{ fontSize: 13, flex: 1 }}>{it.title}</Muted>
                  <Muted style={{ fontSize: 11 }}>{it.kind}</Muted>
                </View>
              ))}
              {spaces[sid].length > 12 && <Muted style={{ fontSize: 11 }}>…and {spaces[sid].length - 12} more</Muted>}
            </View>
          </Card>
        ))}
        {Object.keys(spaces).length === 0 && <Card style={{ marginTop: 8 }}><Muted>No items yet — the calendar, tasks, meals, and files you can see will group here.</Muted></Card>}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
