import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type ApprovalRec, type AuditEvent, type EventRec, type TaskRec, type MemberRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

export default function HomeScreen() {
  const { session } = useSession();
  const [online, setOnline] = useState<boolean | null>(null);
  const [pending, setPending] = useState(0);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [h, aps, ev, evts, tks, mem] = await Promise.all([
      api.health(), api.approvals(), api.audit(8), api.events(), api.tasks(), api.members(),
    ]);
    setOnline(!!h);
    setPending(aps.filter((a: ApprovalRec) => a.status === "pending").length);
    setAudit(ev);
    setEvents(evts);
    setTasks(tks);
    setMembers(mem);
  }, []);

  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = (session?.actorName ?? "there").split(" ")[0];

  const nameOf = (id: string | null) => (id ? members.find((m) => m.actorId === id)?.displayName?.split(" ")[0] ?? null : null);
  const upcoming = [...events]
    .filter((e) => !e.startAt || new Date(e.startAt).getTime() >= Date.now() - 36e5)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, 5);
  const openTasks = tasks.filter((t) => t.status !== "done").slice(0, 6);

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <View style={st.headRow}>
          <View style={{ flex: 1 }}>
            <Eyebrow>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</Eyebrow>
            <H1>Good {part}, {first}</H1>
          </View>
          <Pressable onPress={() => router.push("/settings")} hitSlop={10} style={st.signout} accessibilityRole="button" accessibilityLabel="Settings">
            <Ionicons name="settings-outline" size={22} color={Hearth.ink500} />
          </Pressable>
        </View>

        <Card style={{ marginTop: 16 }}>
          <View style={st.between}>
            <View style={st.row}>
              <View style={[st.dot, { backgroundColor: online ? Hearth.sage500 : Hearth.amber500 }]} />
              <Body style={{ fontWeight: "600" }}>{online == null ? "Checking runtime…" : online ? "Runtime online" : "Runtime offline"}</Body>
            </View>
            <Muted>{session?.role}</Muted>
          </View>
          {online === false && (
            <Muted style={{ marginTop: 6, fontSize: 12 }}>
              Can&apos;t reach the backend at {api.url}. Make sure `npm run dev` is running on your PC and
              you&apos;re on the same Wi-Fi (see apps/mobile/MOBILE_SETUP.md).
            </Muted>
          )}
        </Card>

        <Pressable onPress={() => router.push("/approvals")}>
          <Card style={{ marginTop: 12, borderColor: pending > 0 ? "rgba(217,154,6,0.4)" : Hearth.border, backgroundColor: pending > 0 ? Hearth.amberBg : Hearth.surface }}>
            <View style={st.between}>
              <View style={st.row}>
                <Ionicons name="shield-checkmark-outline" size={20} color={pending > 0 ? Hearth.amber600 : Hearth.ink500} />
                <Body style={{ fontWeight: "600", marginLeft: 8 }}>{pending > 0 ? `${pending} thing${pending === 1 ? "" : "s"} need your approval` : "Nothing waiting on you"}</Body>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Hearth.ink400} />
            </View>
          </Card>
        </Pressable>

        <Pressable onPress={() => router.push("/assistant")}>
          <Card style={{ marginTop: 12 }}>
            <View style={st.row}>
              <Ionicons name="sparkles-outline" size={20} color={Hearth.ember500} />
              <Body style={{ fontWeight: "600", marginLeft: 8 }}>Ask HomeOps to do something</Body>
            </View>
            <Muted style={{ marginTop: 4 }}>Plan a task, draft a message, or get a household summary.</Muted>
          </Card>
        </Pressable>

        <Eyebrow>{"\n"}Upcoming</Eyebrow>
        <Card style={{ marginTop: 8 }}>
          {upcoming.length === 0 ? (
            <Muted>Nothing on the calendar yet.</Muted>
          ) : (
            upcoming.map((e, i) => {
              const driver = nameOf(e.driverId);
              return (
                <View key={e.id} style={[st.itemRow, i > 0 && st.auditDivider]}>
                  <Ionicons name="calendar-outline" size={18} color={Hearth.ink400} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 14, fontWeight: "600" }}>{e.title}</Body>
                    <Muted style={{ fontSize: 12 }}>
                      {e.startAt ? new Date(e.startAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "No time set"}
                      {e.location ? ` · ${e.location}` : ""}
                    </Muted>
                    <View style={st.chips}>
                      {driver && <Badge label={`Driver: ${driver}`} color={Hearth.ink500} bg={Hearth.surface} />}
                      {e.whatToBring?.length > 0 && <Badge label={`Bring ${e.whatToBring.length}`} color={Hearth.ink500} bg={Hearth.surface} />}
                      {e.layer !== "canonical" && <Badge label="synced" color={Hearth.ink400} bg={Hearth.surface} />}
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </Card>

        <Eyebrow>{"\n"}Open tasks</Eyebrow>
        <Card style={{ marginTop: 8 }}>
          {openTasks.length === 0 ? (
            <Muted>You&apos;re all caught up.</Muted>
          ) : (
            openTasks.map((t, i) => {
              const who = nameOf(t.assignedMemberId);
              return (
                <View key={t.id} style={[st.itemRow, i > 0 && st.auditDivider]}>
                  <Ionicons name="ellipse-outline" size={16} color={Hearth.ink400} style={{ marginTop: 3 }} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 14 }}>{t.title}</Body>
                    <Muted style={{ fontSize: 12 }}>
                      {t.type}{who ? ` · ${who}` : ""}{t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                      {t.type === "bill" && t.amount != null ? ` · $${t.amount}` : ""}
                    </Muted>
                  </View>
                </View>
              );
            })
          )}
        </Card>

        <Eyebrow>{"\n"}Recent activity</Eyebrow>
        <Card style={{ marginTop: 8 }}>
          {audit.length === 0 ? (
            <Muted>No recent server activity{session && session.role !== "Owner" && session.role !== "Adult Admin" ? " (admin only)" : ""}.</Muted>
          ) : (
            audit.map((e, i) => (
              <View key={e.id} style={[st.auditRow, i > 0 && st.auditDivider]}>
                <View style={[st.dot, { backgroundColor: e.ok ? Hearth.sage500 : Hearth.coral500 }]} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 14 }}>{e.type}{e.toolId ? ` · ${e.toolId}` : ""}</Body>
                  <Muted style={{ fontSize: 12 }}>{e.actorName ?? "system"} · {new Date(e.at).toLocaleTimeString()}</Muted>
                </View>
                {!e.ok && <Badge label="failed" color={Hearth.coral600} bg={Hearth.coralBg} />}
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  signout: { padding: 6 },
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  auditRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 4 },
  auditDivider: { borderTopWidth: 1, borderTopColor: Hearth.border },
  itemRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 9, gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 },
});
