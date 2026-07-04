import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type AuditEvent, type MemoryRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRun } from "@/lib/run-context";
import { Badge, Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

function stepDotColor(s: string) {
  if (s === "done") return Hearth.sage500;
  if (s === "running") return Hearth.ember500;
  if (s === "blocked") return Hearth.amber500;
  return Hearth.ink400;
}

export default function ActivityScreen() {
  const { session } = useSession();
  const { activeRun, clearRun } = useRun();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [memory, setMemory] = useState<MemoryRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [ev, mem] = await Promise.all([api.audit(20), api.memory()]);
    setEvents(ev);
    setMemory(mem);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Deleting memory is safe by construction — it's reference data, never a live
  // dependency of already-baked agent/skill behavior (server enforces visibility).
  const removeMemory = async (m: MemoryRec) => {
    setMemory((list) => list.filter((x) => x.id !== m.id)); // optimistic
    const r = await api.deleteMemory(m.id);
    if (r.error) void load(); // restore on failure
  };

  const runStatusLabel: Record<string, string> = { running: "Running", waiting: "Waiting for approval", completed: "Completed", failed: "Failed" };
  const runStatusColor: Record<string, string> = { running: Hearth.ember600, waiting: Hearth.amber600, completed: Hearth.sage600, failed: Hearth.coral600 };
  const runStatusBg: Record<string, string> = { running: Hearth.ember50, waiting: Hearth.amberBg, completed: Hearth.sageBg, failed: Hearth.coralBg };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <H1>Activity</H1>
        <Muted style={{ marginTop: 4 }}>Live runs, step history, and server events.</Muted>

        {activeRun ? (
          <View style={{ marginTop: 20 }}>
            <View style={st.sectionHead}>
              <Eyebrow>Current run</Eyebrow>
              {(activeRun.status === "completed" || activeRun.status === "failed") && (
                <Pressable onPress={clearRun} hitSlop={8}>
                  <Ionicons name="close-circle-outline" size={18} color={Hearth.ink400} />
                </Pressable>
              )}
            </View>
            <Card style={{ marginTop: 8, borderColor: runStatusColor[activeRun.status] ? `${runStatusColor[activeRun.status]}33` : Hearth.border, backgroundColor: runStatusBg[activeRun.status] ?? Hearth.surface }}>
              <View style={st.between}>
                <Body style={{ fontWeight: "700", flex: 1 }}>{activeRun.planTitle}</Body>
                <Badge label={runStatusLabel[activeRun.status] ?? activeRun.status} color={runStatusColor[activeRun.status] ?? Hearth.ink500} bg={Hearth.surfaceSunken} />
              </View>
              <View style={{ marginTop: 10, gap: 6 }}>
                {activeRun.steps.map((s, i) => (
                  <View key={i} style={st.stepRow}>
                    <View style={[st.stepDot, { backgroundColor: stepDotColor(s.status) }]} />
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 14, fontWeight: "600" }}>{s.title}</Body>
                      {s.output ? <Muted style={{ fontSize: 12 }}>{s.output}</Muted> : s.detail ? <Muted style={{ fontSize: 12 }}>{s.detail}</Muted> : null}
                    </View>
                    {s.status === "running" && <Ionicons name="ellipsis-horizontal" size={16} color={Hearth.ember500} />}
                    {s.status === "done" && <Ionicons name="checkmark-circle" size={16} color={Hearth.sage500} />}
                    {s.status === "blocked" && <Ionicons name="pause-circle" size={16} color={Hearth.amber500} />}
                  </View>
                ))}
              </View>
              {activeRun.status === "waiting" && (
                <Muted style={{ marginTop: 8, fontSize: 12 }}>Go to the Approvals tab to review gated steps, then re-run.</Muted>
              )}
            </Card>
          </View>
        ) : null}

        <View style={{ marginTop: 20 }}>
          <Eyebrow>Memory</Eyebrow>
          <Card style={{ marginTop: 8 }}>
            {memory.length === 0 ? (
              <Muted>No memories yet — helpers write these as they learn your household's routines.</Muted>
            ) : memory.map((m, i) => (
              <View key={m.id} style={[st.auditRow, i > 0 && st.auditDivider]}>
                <Ionicons name="bulb-outline" size={15} color={Hearth.amber600} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 14 }}>{m.text}</Body>
                  <Muted style={{ fontSize: 12 }}>{m.type}{m.scope === "personal" ? " · personal" : ""} · {new Date(m.createdAt).toLocaleDateString()}</Muted>
                </View>
                <Pressable onPress={() => void removeMemory(m)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete memory: ${m.text.slice(0, 40)}`}>
                  <Ionicons name="trash-outline" size={16} color={Hearth.ink400} />
                </Pressable>
              </View>
            ))}
          </Card>
        </View>

        <View style={{ marginTop: 20 }}>
          <Eyebrow>Server events</Eyebrow>
          <Card style={{ marginTop: 8 }}>
            {events.length === 0 ? (
              <Muted>No server events yet — run a plan to see activity here.</Muted>
            ) : events.map((e, i) => (
              <View key={e.id} style={[st.auditRow, i > 0 && st.auditDivider]}>
                <View style={[st.dot, { backgroundColor: e.ok ? Hearth.sage500 : Hearth.coral500 }]} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 14 }}>{e.type}{e.toolId ? ` · ${e.toolId}` : ""}</Body>
                  <Muted style={{ fontSize: 12 }}>{e.actorName ?? "system"} · {new Date(e.at).toLocaleTimeString()}</Muted>
                </View>
                {!e.ok && <Badge label="failed" color={Hearth.coral600} bg={Hearth.coralBg} />}
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: Hearth.rim, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: Hearth.border },
  stepDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 3 },
  auditRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 4 },
  auditDivider: { borderTopWidth: 1, borderTopColor: Hearth.border },
});
