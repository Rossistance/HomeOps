import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { api, type ApprovalRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth, riskColor } from "@/constants/hearth";

// The approval record deliberately carries only a hash of its input — the REAL resolved
// content lives on the originating run step. Render it as readable "Label: value" lines
// (long id lists collapse to a count), mirroring the web's formatApprovalInput.
function formatInput(input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v == null || v === "") continue;
    const label = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
    const s = Array.isArray(v) ? v : typeof v === "string" && v.includes(",") && v.length > 60 ? v.split(",") : null;
    if (s && s.length > 3) { lines.push(`${label}: ${s.length} item(s)`); continue; }
    const text = typeof v === "object" ? JSON.stringify(v) : String(v);
    lines.push(`${label}: ${text.length > 120 ? text.slice(0, 117) + "…" : text}`);
  }
  return lines.join("\n");
}

export default function ApprovalsScreen() {
  const { session } = useSession();
  const [items, setItems] = useState<ApprovalRec[]>([]);
  const [stepInputs, setStepInputs] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const approvals = await api.approvals();
    setItems(approvals);
    // Enrich pending approvals with the gated run step's real input (item E mirror).
    if (approvals.some((a) => a.status === "pending")) {
      const runs = await api.runs("waiting_for_approval");
      const map: Record<string, string> = {};
      for (const r of runs) for (const s of r.steps) {
        if (s.approvalId && Object.keys(s.input ?? {}).length) {
          const txt = formatInput(s.input);
          if (txt) map[s.approvalId] = txt;
        }
      }
      setStepInputs(map);
    }
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    await api.decideApproval(id, approve);
    await load();
    setBusyId(null);
  };

  const pending = items.filter((a) => a.status === "pending");
  const decided = items.filter((a) => a.status !== "pending").slice(0, 10);

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <H1>Approvals</H1>
        <Muted style={{ marginTop: 4 }}>Review what your agents want to do. Server-enforced — nothing runs without your sign-off.</Muted>

        {pending.length === 0 ? (
          <Card style={{ marginTop: 16 }}>
            <Body style={{ fontWeight: "700" }}>All caught up</Body>
            <Muted style={{ marginTop: 2 }}>No pending approvals right now.</Muted>
          </Card>
        ) : pending.map((a) => (
          <Card key={a.id} style={{ marginTop: 12 }}>
            <View style={st.between}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{a.toolId}</Body>
              <Badge label={`${a.risk} risk`} color={riskColor(a.risk)} bg={Hearth.surfaceSunken} />
            </View>
            {a.preview ? <Muted style={{ marginTop: 6 }}>{a.preview}</Muted> : null}
            {stepInputs[a.id] ? (
              <View style={st.inputBox}>
                <Muted style={{ fontSize: 12, lineHeight: 18 }}>{stepInputs[a.id]}</Muted>
              </View>
            ) : null}
            <Muted style={{ marginTop: 6, fontSize: 12 }}>{a.category}{a.connectorId ? ` · ${a.connectorId}` : ""}</Muted>
            <View style={st.actions}>
              <View style={{ flex: 1 }}><Button title="Approve" variant="success" onPress={() => decide(a.id, true)} loading={busyId === a.id} /></View>
              <View style={{ flex: 1 }}><Button title="Deny" variant="danger" onPress={() => decide(a.id, false)} disabled={busyId === a.id} /></View>
            </View>
          </Card>
        ))}

        {decided.length > 0 ? (
          <View>
            <Eyebrow>{"\n"}Recently decided</Eyebrow>
            {decided.map((a) => (
              <Card key={a.id} style={{ marginTop: 8, opacity: 0.7 }}>
                <View style={st.between}>
                  <Body style={{ flex: 1 }}>{a.toolId}</Body>
                  <Badge label={a.status} color={a.status === "approved" || a.status === "consumed" ? Hearth.sage600 : Hearth.ink500} bg={Hearth.surfaceSunken} />
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  inputBox: { marginTop: 8, backgroundColor: Hearth.surfaceSunken, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Hearth.border },
});
