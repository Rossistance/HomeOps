// Famili's suggestions for a message, beside the bubble: one small chip per open
// suggestion (calendar / task / help). Tap opens a card with the proposed change and
// Add / Update / Ask owner / Dismiss. Once anyone acts, the chip is gone for everyone on the
// next poll — the server flips the status atomically, so two people tapping race to one
// winner and the loser is told.
import { useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { api, type MessageRec, type SuggestionRec } from "@/lib/api";
import { useTheme, tapHaptic } from "@/theme";
import { T, Sym, Button, HSheet, Well, PressableScale } from "@/components/ui";

const ICON: Record<SuggestionRec["type"], string> = { event: "calendar.badge.plus", task: "checkmark.circle", help: "hand.raised" };
const NOUN: Record<SuggestionRec["type"], string> = { event: "calendar event", task: "task", help: "help request" };

function patchLines(patch: Record<string, unknown>): string[] {
  const label: Record<string, string> = { title: "Title", startAt: "Starts", endAt: "Ends", dueAt: "Due", location: "Where", notes: "Notes", assignedMemberId: "For", toActorId: "Ask", message: "Ask", priority: "Priority", allDay: "All day" };
  const out: string[] = [];
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v == null || v === "" || k === "title") continue;
    let text = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : String(v);
    if (typeof v === "boolean") text = v ? "yes" : "no";
    out.push(`${label[k] ?? k}: ${text}`);
  }
  return out;
}

export function SuggestionRail({ threadId, message, suggestions, onDone }: {
  threadId: string; message: MessageRec; suggestions: SuggestionRec[]; onDone: () => void;
}) {
  const { colors, spacing } = useTheme();
  const [open, setOpen] = useState<SuggestionRec | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: "apply" | "dismiss") {
    if (!open) return;
    setBusy(true);
    const r = await api.actOnSuggestion(threadId, message.id, open.id, action);
    setBusy(false);
    if (r.error === "already_taken") {
      tapHaptic("warning");
      Alert.alert("Already handled", r.message ?? "Someone in the chat got to this one first.");
    } else if (r.error) {
      tapHaptic("error");
      Alert.alert("Couldn't do that", r.message ?? r.error);
    } else {
      tapHaptic("success");
      const res = r.suggestion?.result;
      if (action === "apply" && res?.created?.type === "event" && res.created.id) {
        setOpen(null); onDone();
        router.push({ pathname: "/event-form", params: { id: res.created.id } });
        return;
      }
    }
    setOpen(null);
    onDone();
  }

  const verb = open ? (open.kind === "create" ? "Add" : open.ownerActorId && open.result?.requested ? "Ask owner" : "Update") : "";
  return (
    <>
      <View style={{ gap: 4, alignSelf: "flex-end", paddingBottom: 6 }}>
        {suggestions.slice(0, 3).map((s) => (
          <PressableScale
            key={s.id}
            onPress={() => setOpen(s)}
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel={`Suggestion: ${s.kind === "create" ? "add" : "update"} ${NOUN[s.type]} ${s.title}`}
            style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.emberBg, borderWidth: 1, borderColor: colors.border }}
          >
            <Sym name={ICON[s.type]} size={13} color={colors.ember} />
          </PressableScale>
        ))}
      </View>
      <HSheet visible={!!open} onClose={() => setOpen(null)} title={open ? `${open.kind === "create" ? "Add a" : "Update this"} ${NOUN[open.type]}?` : ""} heightPct={0.6}
        footer={open ? (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Button title="Dismiss" variant="neutral" icon="xmark" disabled={busy} onPress={() => void act("dismiss")} /></View>
            <View style={{ flex: 2 }}><Button title={open.kind === "update" && open.ownerActorId ? "Update or ask" : verb} variant="ember" icon={open.kind === "create" ? "plus" : "arrow.triangle.2.circlepath"} loading={busy} onPress={() => void act("apply")} /></View>
          </View>
        ) : undefined}
      >
        {open ? (
          <View style={{ gap: spacing.md }}>
            <T kind="sub">Famili noticed this in the chat. Nothing changes until someone taps; then it's gone for everyone here.</T>
            <Well>
              <T kind="bodyMedium">{open.title}</T>
              {open.summary ? <T kind="sub" style={{ marginTop: 4 }}>{open.summary}</T> : null}
              {patchLines(open.patch).map((l) => <T key={l} kind="sub" color={colors.textSecondary} style={{ marginTop: 4 }}>{l}</T>)}
            </Well>
            {open.kind === "update" ? (
              <T kind="caption" color={colors.textMuted}>
                If you own the item (or run the household) the change is applied. Otherwise the owner gets a request with this change, and nothing moves until they say yes.
              </T>
            ) : null}
          </View>
        ) : null}
      </HSheet>
    </>
  );
}
