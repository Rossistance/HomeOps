// The signature approval flow (88% sheet). Risk pill, what the agent wants to
// do, why it needs you, the exact preview — then Deny / Ask for changes /
// Approve. Decisions hit the real API and confirm with a flash. "Ask for
// changes" runs a real re-plan loop: it pulls the gated run's original steps,
// asks the assistant for a revised plan, stops the stale run, and dispatches the
// revision (mirrors the web's askAgentForChanges).
import { useMemo, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, type ApprovalRec } from "@/lib/api";
import { useRun } from "@/lib/run-context";
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
  const { startRun } = useRun();
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
      Alert.alert("Couldn't record your decision", r.error === "insufficient_role"
        ? "Only household adults can decide approvals."
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

  // Real "ask for changes": re-invoke the planner with the ORIGINAL plan + the user's
  // feedback to produce a REVISED plan, stop the stale run, dispatch the revision, and
  // jump to the live run monitor. Falls back to drafting the change in Ask when the
  // approval isn't tied to a server run (client-orchestrated), and to stop-and-tell when
  // re-planning can't produce a plan (no AI provider, etc.).
  async function reworkPlan() {
    if (!approval || working) return;
    const a = approval;
    const note = feedback.trim();
    if (!note) return;
    setWorking(true);
    // The approval gates a server run step (step carries approvalId) — find it.
    const runs = await api.runs();
    const run = runs.find((r) => r.steps.some((s) => s.approvalId === a.id));
    if (!run) {
      // No linked server run — draft the requested change in Ask instead.
      setWorking(false);
      closeAndReset();
      router.push({ pathname: "/(ask)", params: { prefill: `About the pending approval "${firstLine}": please change it so that ${note}` } });
      return;
    }
    // Pull the ORIGINAL plan (full steps incl. toolId + input) from the server run.
    const full = await api.getRun(run.id);
    const steps = (full.run?.steps ?? run.steps).map((s) => ({ toolId: s.toolId, title: s.title, detail: s.detail, input: s.input ?? {} }));
    if (!steps.length) {
      await stopStale(run.id);
      setWorking(false);
      onDecided();
      closeAndReset();
      Alert.alert("Run stopped", "Start a new run with your changes.");
      return;
    }
    const msg = `Revise the following plan based on my feedback, keeping everything that still applies and changing only what my feedback asks for. Return a revised plan (kind:"plan").\n\nOriginal plan "${run.title || "Plan"}" steps (JSON): ${JSON.stringify(steps).slice(0, 3000)}\n\nMy feedback: ${note}`;
    const out = await api.assistant(msg);
    if (out.ok && out.kind === "plan" && out.plan) {
      await stopStale(run.id);
      await startRun({ ...out.plan, title: out.plan.title || `Revised: ${run.title || "plan"}` });
      setWorking(false);
      onDecided();
      closeAndReset();
      // Jump to the live run so the user sees the revision executing.
      router.push("/activity");
      return;
    }
    // Re-planning didn't yield a plan — honest fallback: stop the stale run.
    await stopStale(run.id);
    setWorking(false);
    onDecided();
    closeAndReset();
    Alert.alert(
      "Run stopped",
      out.ok
        ? "I couldn't draft a revision automatically — start a new run with your changes."
        : "Couldn't reach the planner — start a new run with your changes.",
    );
  }

  return (
    <>
      <HSheet visible={visible} onClose={closeAndReset} title="Approval" heightPct={0.88}>
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
                I'll rework the plan with your feedback, stop this pending step, and start the revised run.
              </T>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" small variant="ghost" disabled={working} onPress={() => { setAsking(false); setFeedback(""); }} />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Button title={working ? "Reworking…" : "Rework the plan"} small variant="ember" icon="wand.and.stars" loading={working} disabled={!feedback.trim()} onPress={() => void reworkPlan()} />
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
