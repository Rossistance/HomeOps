// The signature approval flow (88% sheet). Risk pill, what the agent wants to
// do, why it needs you, the exact preview — then Deny / Ask for changes /
// Approve. Decisions hit the real API and confirm with a flash.
import { useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, type ApprovalRec } from "@/lib/api";
import { useTheme, riskColor } from "@/theme";
import { T, Badge, Well, SymTile, PressableScale, HSheet, useConfirmFlash } from "@/components/ui";

function humanizeTool(toolId: string): string {
  const last = toolId.split(".").pop() ?? toolId;
  return last.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function iconFor(a: ApprovalRec): string {
  const k = `${a.toolId} ${a.category}`.toLowerCase();
  if (k.includes("mail") || k.includes("email")) return "envelope";
  if (k.includes("sms") || k.includes("text") || k.includes("message")) return "paperplane";
  if (k.includes("calendar") || k.includes("event")) return "calendar";
  if (k.includes("file") || k.includes("doc")) return "doc.text";
  return "checkmark.shield";
}

function expiresIn(a: ApprovalRec): string | null {
  const ms = a.expiresAt - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 60) return `Expires in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `Expires in ${h} hour${h === 1 ? "" : "s"}`;
  return `Expires in ${Math.round(h / 24)} days`;
}

export function ApprovalSheet({ approval, visible, onClose, onDecided }: {
  approval: ApprovalRec | null;
  visible: boolean;
  onClose: () => void;
  onDecided: () => void;
}) {
  const { colors, spacing } = useTheme();
  const { flash, show } = useConfirmFlash();
  const [busy, setBusy] = useState(false);

  const firstLine = useMemo(
    () => (approval?.preview ?? "").split("\n").find((l) => l.trim()) ?? (approval ? humanizeTool(approval.toolId) : ""),
    [approval],
  );

  if (!approval) return <>{flash}</>;
  const risk = riskColor(colors, approval.risk);
  const expiry = expiresIn(approval);

  async function decide(approve: boolean) {
    if (!approval || busy) return;
    setBusy(true);
    const r = await api.decideApproval(approval.id, approve);
    setBusy(false);
    if (r.error) {
      Alert.alert("Couldn't record your decision", r.error === "insufficient_role"
        ? "Only household adults can decide approvals."
        : "Something went wrong — pull to refresh and try again.");
      return;
    }
    show(approve ? "approve" : "deny", () => { onDecided(); onClose(); });
  }

  function askForChanges() {
    onClose();
    router.push({ pathname: "/(ask)", params: { prefill: `About the pending approval "${firstLine}": please change it so that ` } });
  }

  return (
    <>
      <HSheet visible={visible} onClose={onClose} title="Approval" heightPct={0.88}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg }}>
          {/* agent / tool identity + risk pill */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <SymTile name={iconFor(approval)} color={risk.fg} bg={risk.bg} size={44} iconSize={20} />
            <View style={{ flex: 1, gap: 2 }}>
              <T kind="rowTitle">{humanizeTool(approval.toolId)}</T>
              {!!approval.category && <T kind="detail">{approval.category}</T>}
            </View>
            <Badge label={`${approval.risk} risk`} fg={risk.fg} bg={risk.bg} />
          </View>

          <T kind="hero">{firstLine}</T>

          <View style={{ gap: 6 }}>
            <T kind="eyebrow">Why this needs you</T>
            <Well>
              <T kind="sub" color={colors.textSecondary}>
                This is a {approval.risk.toLowerCase()}-risk action{approval.category ? ` in ${approval.category}` : ""}. Nothing happens until you approve it.
                {expiry ? `\n${expiry}.` : ""}
              </T>
            </Well>
          </View>

          <View style={{ gap: 6 }}>
            <T kind="eyebrow">Preview</T>
            <Well style={{ borderLeftWidth: 3, borderLeftColor: risk.fg }}>
              <T kind="sub" color={colors.textSecondary}>{approval.preview || "No preview provided."}</T>
            </Well>
          </View>

          <PressableScale onPress={askForChanges} haptic="select" style={{ alignSelf: "center", paddingVertical: 4 }}>
            <T kind="subMedium" color={colors.ember}>Ask for changes</T>
          </PressableScale>
        </ScrollView>

        <View style={{ flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.sm }}>
          <PressableScale
            onPress={() => void decide(false)}
            disabled={busy}
            style={{
              flex: 1, height: 52, borderRadius: 15, borderCurve: "continuous",
              alignItems: "center", justifyContent: "center",
              backgroundColor: colors.surfaceSunken, opacity: busy ? 0.6 : 1,
            }}
          >
            <T kind="bodyMedium" color={colors.coral} style={{ fontWeight: "600" }}>Deny</T>
          </PressableScale>
          <PressableScale onPress={() => void decide(true)} disabled={busy} style={{ flex: 1.4, borderRadius: 15, borderCurve: "continuous", overflow: "hidden", opacity: busy ? 0.6 : 1 }}>
            <LinearGradient
              colors={[colors.hero1, colors.hero2]}
              start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }}
              style={{ height: 52, alignItems: "center", justifyContent: "center" }}
            >
              <T kind="bodyMedium" color={colors.heroText} style={{ fontWeight: "600" }}>Approve</T>
            </LinearGradient>
          </PressableScale>
        </View>
      </HSheet>
      {flash}
    </>
  );
}
