// A shared thing inside a message: a compact card with what it is, when, who — and an Open
// button to the real item. The preview is resolved by the server for THIS reader, so a
// private event shared into a chat shows "Something you don't have access to" rather than
// its title.
import { View } from "react-native";
import { router } from "expo-router";
import type { SharePreview, ShareType } from "@/lib/api";
import { useTheme } from "@/theme";
import { T, Sym, SymTile, PressableScale } from "@/components/ui";

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

export function ShareCard({ type, preview, mine }: { type: ShareType; preview: SharePreview | null | undefined; mine: boolean }) {
  const { colors, spacing, radii } = useTheme();
  const p = preview ?? { hidden: true };
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
