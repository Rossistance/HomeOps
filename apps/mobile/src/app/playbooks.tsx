import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type PlaybookRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Playbooks — browse the household's step-by-step workflows. Read-only on mobile;
// authoring stays on the web (and via the chat-builder).
export default function PlaybooksScreen() {
  const { session } = useSession();
  const [playbooks, setPlaybooks] = useState<PlaybookRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => setPlaybooks((await api.playbooks()).filter((p) => !p.archived)), []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const byCategory = useMemo(() => {
    const map: Record<string, PlaybookRec[]> = {};
    for (const p of playbooks) (map[p.category || "Custom"] ??= []).push(p);
    return map;
  }, [playbooks]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <H1>Playbooks</H1>
        <Muted style={{ marginTop: 4 }}>Step-by-step workflows your helpers follow. Read them here; edit on the web app.</Muted>

        {playbooks.length === 0 && (
          <Card style={{ marginTop: 16 }}><Muted>No playbooks yet. Ask HomeOps to draft one, or create one on the web app.</Muted></Card>
        )}

        {Object.keys(byCategory).sort().map((cat) => (
          <View key={cat} style={{ marginTop: 16 }}>
            <Eyebrow>{cat}</Eyebrow>
            {byCategory[cat].map((p) => {
              const open = expanded === p.id;
              return (
                <Card key={p.id} style={{ marginTop: 8 }}>
                  <Pressable onPress={() => setExpanded(open ? null : p.id)} accessibilityRole="button"
                    accessibilityLabel={`${p.name}, ${p.steps.length} steps${open ? ", collapse" : ", expand"}`}>
                    <View style={st.between}>
                      <View style={{ flex: 1 }}>
                        <View style={st.row}>
                          <Body style={{ fontWeight: "600", flexShrink: 1 }}>{p.name}</Body>
                          <Badge label={`${p.steps.length} steps`} color={Hearth.ink500} bg={Hearth.surfaceSunken} />
                        </View>
                        {p.description ? <Muted style={{ fontSize: 12, marginTop: 2 }}>{p.description}</Muted> : null}
                      </View>
                      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={Hearth.ink400} />
                    </View>
                  </Pressable>
                  {open && (
                    <View style={{ marginTop: 10, gap: 10 }}>
                      {p.whenToUse ? (
                        <View>
                          <Eyebrow>When to use</Eyebrow>
                          <Body style={{ fontSize: 14, marginTop: 2 }}>{p.whenToUse}</Body>
                        </View>
                      ) : null}
                      <View>
                        <Eyebrow>Steps</Eyebrow>
                        {p.steps.map((s, i) => (
                          <View key={i} style={st.stepRow}>
                            <View style={st.stepNum}><Body style={{ fontSize: 12, fontWeight: "700", color: Hearth.ember600 }}>{i + 1}</Body></View>
                            <Body style={{ fontSize: 14, flex: 1 }}>{s}</Body>
                          </View>
                        ))}
                      </View>
                      {p.requiredConnections.length > 0 && (
                        <View>
                          <Eyebrow>Needs</Eyebrow>
                          <View style={[st.row, { marginTop: 4, flexWrap: "wrap" }]}>
                            {p.requiredConnections.map((c) => <Badge key={c} label={c} color={Hearth.sky500} bg={Hearth.skyBg} />)}
                          </View>
                        </View>
                      )}
                      {p.approvalRules.length > 0 && (
                        <View>
                          <Eyebrow>Pauses for approval</Eyebrow>
                          {p.approvalRules.map((r, i) => <Body key={i} style={{ fontSize: 13, marginTop: 2 }}>• {r}</Body>)}
                        </View>
                      )}
                      {p.outputFormat ? (
                        <View>
                          <Eyebrow>Produces</Eyebrow>
                          <Body style={{ fontSize: 13, marginTop: 2 }}>{p.outputFormat}</Body>
                        </View>
                      ) : null}
                    </View>
                  )}
                </Card>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 8 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: Hearth.ember50, alignItems: "center", justifyContent: "center", marginTop: 1 },
});
