// A shared thing inside a message: a compact card with what it is, when, who — and an Open
// button to the real item. The preview is resolved by the server for THIS reader, so a
// private event shared into a chat shows "Something you don't have access to" rather than
// its title.
import { useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { api, type SharePreview, type ShareType } from "@/lib/api";
import { useTheme, tapHaptic } from "@/theme";
import { T, Sym, SymTile, PressableScale, Button } from "@/components/ui";

const ICON: Record<ShareType, string> = {
  event: "calendar", task: "checkmark.circle", file: "doc", meal: "fork.knife", list_item: "cart",
  help_request: "hand.raised", notification: "sparkles",
};
const LABEL: Record<ShareType, string> = {
  event: "Event", task: "Task", file: "File", meal: "Meal", list_item: "Grocery item", help_request: "Help request", notification: "Update",
};

function whenLabel(p: SharePreview): string | null {
  if (!p.when) return null;
  const d = new Date(p.when);
  if (!Number.isFinite(d.getTime())) return p.when;
  return p.allDay
    ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ShareCard({ type, preview, mine, onChanged }: { type: ShareType; preview: SharePreview | null | undefined; mine: boolean; onChanged?: () => void }) {
  const { colors, spacing, radii } = useTheme();
  const p = preview ?? { hidden: true };
  const [busy, setBusy] = useState(false);
  async function answer(response: "accept" | "decline") {
    if (!p.id) return;
    setBusy(true);
    const r = await api.respondHelpRequest(p.id, response);
    setBusy(false);
    if (r.error) { tapHaptic("error"); Alert.alert("Couldn't answer", r.message ?? r.error); return; }
    tapHaptic(response === "accept" ? "success" : "warning");
    onChanged?.();
  }
  const border = mine ? "rgba(255,255,255,0.28)" : colors.border;
  const fg = mine ? colors.onEmber : colors.text;
  const muted = mine ? "rgba(255,255,255,0.78)" : colors.textMuted;
  if (p.hidden) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, borderWidth: 1, borderColor: border }}>
        <Sym name="lock" size={14} color={muted} />
        <T kind="sub" color={muted} style={{ flex: 1 }}>Shared a {LABEL[type].toLowerCase()} you don't have access to</T>
      </View>
    );
  }
  const when = whenLabel(p);
  const lines = [when, p.where, p.who ? (type === "help_request" ? `${p.who} → ${p.to ?? "?"}` : p.who) : null, p.status].filter(Boolean) as string[];
  if (type === "help_request") {
    // A question to a person: what it is about, what a yes does, and — for the person asked —
    // the two answers. Everyone else sees whose answer it is waiting on.
    const ev = p.event;
    return (
      <View style={{ gap: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, borderWidth: 1, borderColor: border, backgroundColor: mine ? "rgba(255,255,255,0.10)" : colors.surfaceSunken, minWidth: 220 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <SymTile name="hand.raised" color={mine ? colors.onEmber : colors.ember} bg={mine ? "rgba(255,255,255,0.16)" : colors.emberBg} size={30} iconSize={14} />
          <View style={{ flex: 1 }}>
            <T kind="caption" color={muted}>{p.who} asked {p.to}</T>
            <T kind="bodyMedium" color={fg}>{p.title}</T>
          </View>
        </View>
        {ev ? (
          <PressableScale onPress={() => router.push({ pathname: "/event-form", params: { id: ev.id } })} haptic="select" accessibilityRole="button" accessibilityLabel={`Open ${ev.title}`} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Sym name="calendar" size={12} color={muted} />
            <T kind="caption" color={muted} style={{ flex: 1 }} numberOfLines={1}>{ev.title}{ev.when ? ` · ${whenLabel({ when: ev.when })}` : ""}{p.does ? ` · ${p.does}` : ""}</T>
          </PressableScale>
        ) : null}
        {p.canRespond ? (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Button title="Yes" small variant="ember" icon="checkmark" loading={busy} onPress={() => void answer("accept")} /></View>
            <View style={{ flex: 1 }}><Button title="No" small variant="neutral" icon="xmark" disabled={busy} onPress={() => void answer("decline")} /></View>
          </View>
        ) : (
          <T kind="caption" color={p.status === "accepted" ? colors.sage : p.status === "declined" ? colors.coral : muted}>
            {p.status === "pending" ? `Waiting on ${p.to}` : p.status === "accepted" ? `${p.to} said yes` : p.status === "declined" ? `${p.to} said no` : p.status}
          </T>
        )}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={p.route ? () => router.push({ pathname: p.route!.pathname as never, params: p.route!.params } as never) : undefined}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={`Open ${LABEL[type].toLowerCase()}: ${p.title ?? ""}`}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, borderWidth: 1, borderColor: border, backgroundColor: mine ? "rgba(255,255,255,0.10)" : colors.surfaceSunken }}
    >
      <SymTile name={ICON[type]} color={mine ? colors.onEmber : colors.ember} bg={mine ? "rgba(255,255,255,0.16)" : colors.emberBg} size={34} iconSize={16} />
      <View style={{ flex: 1, gap: 1 }}>
        <T kind="caption" color={muted}>{LABEL[type]}</T>
        <T kind="bodyMedium" color={fg} numberOfLines={2}>{p.title ?? LABEL[type]}</T>
        {lines.length ? <T kind="caption" color={muted} numberOfLines={2}>{lines.join(" · ")}</T> : null}
        {type === "notification" && p.body ? <T kind="sub" color={muted} numberOfLines={4}>{p.body}</T> : null}
      </View>
      {p.route ? <Sym name="chevron.right" size={12} color={muted} /> : null}
    </PressableScale>
  );
}
