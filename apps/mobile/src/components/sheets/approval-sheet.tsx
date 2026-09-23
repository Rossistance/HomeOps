// The signature approval flow (88% sheet). Risk pill, what the helper wants to
// do, why it needs you, the exact preview — then Deny / Ask for changes /
// Approve. Decisions hit the real API and confirm with a flash. "Ask for
// changes" stops the gated run and carries your words into Ask, unsent.
import { useMemo, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, type ApprovalRec } from "@/lib/api";
import { useTheme, riskColor } from "@/theme";
import { T, Badge, Button, Well, SymTile, PressableScale, HSheet, useConfirmFlash } from "@/components/ui";

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
  const { colors, spacing, type } = useTheme();
  const { flash, show } = useConfirmFlash();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [working, setWorking] = useState(false);

  const firstLine = useMemo(
    () => (approval?.preview ?? "").split("\n").find((l) => l.trim()) ?? (approval ? humanizeTool(approval.toolId) : ""),
    [approval],
  );

  if (!approval) return <>{flash}</>;
  const risk = riskColor(colors, approval.risk);
  const expiry = expiresIn(approval);

  function closeAndReset() {
    setAsking(false);
    setFeedback("");
    onClose();
  }

  async function decide(approve: boolean) {
    if (!approval || busy || working) return;
    setBusy(true);
    const r = await api.decideApproval(approval.id, approve);
    setBusy(false);
    if (r.error) {
      // The decide route answers 403 `approver_not_allowed` when this profile's role is not on
      // the approval's allowedApproverRoles (server/index.mjs); `insufficient_role` is the older
      // shape and is kept. Name who can, since the record says.
      const notAllowed = r.error === "approver_not_allowed" || r.error === "insufficient_role";
      const roles = approval.allowedApproverRoles ?? [];
      const who = roles.length > 1 ? `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}` : roles[0];
      Alert.alert("Couldn't record your decision", notAllowed
        ? `This profile can't approve this one${who ? ` — ${who} can decide it` : ""}.`
        : "Something went wrong — pull to refresh and try again.");
      return;
    }
    show(approve ? "approve" : "deny", () => { onDecided(); closeAndReset(); });
  }

  // Invalidate the stale approval so it can never execute, then stop its run.
  async function stopStale(runId: string) {
    if (!approval) return;
    await api.decideApproval(approval.id, false);
    await api.cancelRun(runId);
  }

  /* "Ask for changes": stop what was about to happen, and take the conversation to Ask
   * with your words already in it.
   *
   * This used to re-invoke the planner with the original steps as JSON and dispatch whatever
   * plan came back — a second, invisible run started on your behalf from a "this isn't quite
   * right" note. That whole shape is gone: the engine returns prose, not plans, and the
   * assistant acts for itself rather than handing back a machine-readable proposal for the
   * phone to execute.
   *
   * What replaces it is smaller and more honest. The stale approval is denied (so it can
   * never fire) and its run cancelled, then your feedback opens in Ask as a message you can
   * still edit before sending. Nothing runs until you say so, which is the point of an
   * approval sheet in the first place. */
  async function reworkPlan() {
    if (!approval || working) return;
    const a = approval;
    const note = feedback.trim();
    if (!note) return;
    setWorking(true);
    // The approval gates a server run step (the step carries approvalId) — find and stop it.
    const runs = await api.runs();
    const run = runs.find((r) => r.steps.some((s) => s.approvalId === a.id));
    if (run) await stopStale(run.id);
    setWorking(false);
    if (run) onDecided();
    closeAndReset();
    // Prefilled, NOT sent: "prefill" fills the composer and waits for you (see (ask)/index).
    router.push({
      pathname: "/(ask)",
      params: { prefill: `About "${firstLine}" — I stopped it. Please do it this way instead: ${note}` },
    });
  }

  return (
    <>
      <HSheet visible={visible} onClose={closeAndReset} title="Approval" heightPct={0.88}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg }}>
          {/* helper / tool identity + risk pill */}
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

          {asking ? (
            <View style={{ gap: spacing.sm }}>
              <T kind="eyebrow">What should change?</T>
              <Well style={{ padding: 0 }}>
                <TextInput
                  value={feedback}
                  onChangeText={setFeedback}
                  placeholder="e.g. use a friendlier tone, move it to Saturday…"
                  placeholderTextColor={colors.textFaint}
                  multiline
                  editable={!working}
                  accessibilityLabel="Describe the change you want"
                  style={[type.body, { color: colors.text, minHeight: 76, paddingHorizontal: 14, paddingVertical: 12 }]}
                />
              </Well>
              <T kind="detail">
                I'll stop this step and open Ask with your note — nothing is sent until you press send.
              </T>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" small variant="ghost" disabled={working} onPress={() => { setAsking(false); setFeedback(""); }} />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Button title={working ? "Stopping…" : "Stop and rewrite"} small variant="ember" icon="wand.and.stars" loading={working} disabled={!feedback.trim()} onPress={() => void reworkPlan()} />
                </View>
              </View>
            </View>
          ) : (
            <PressableScale onPress={() => setAsking(true)} haptic="select" disabled={busy || working} style={{ alignSelf: "center", paddingVertical: 4 }}>
              <T kind="subMedium" color={colors.ember}>Ask for changes</T>
            </PressableScale>
          )}
        </ScrollView>

        <View style={{ flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.sm }}>
          <PressableScale
            onPress={() => void decide(false)}
            disabled={busy || working}
            style={{
              flex: 1, height: 52, borderRadius: 15, borderCurve: "continuous",
              alignItems: "center", justifyContent: "center",
              backgroundColor: colors.surfaceSunken, opacity: busy || working ? 0.6 : 1,
            }}
          >
            <T kind="bodyMedium" color={colors.coral} style={{ fontWeight: "600" }}>Deny</T>
          </PressableScale>
          <PressableScale onPress={() => void decide(true)} disabled={busy || working} style={{ flex: 1.4, borderRadius: 15, borderCurve: "continuous", overflow: "hidden", opacity: busy || working ? 0.6 : 1 }}>
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
