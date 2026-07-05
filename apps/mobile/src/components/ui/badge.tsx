// Badge (status pill) and Chip (selectable filter). Status colors keep meaning:
// sage=done, amber=pending/warning, coral=attention, sky=info, lavender=sensitive.
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme, tapHaptic } from "@/theme";
import { PressableScale } from "./pressable-scale";
import { T } from "./text";
import { Sym } from "./symbol";

export function Badge({ label, fg, bg, icon }: { label: string; fg: string; bg: string; icon?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: bg, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 }}>
      {icon ? <Sym name={icon} size={11} color={fg} /> : null}
      <T kind="caption" color={fg}>{label}</T>
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: string }) {
  const { colors, dark } = useTheme();
  return (
    <PressableScale
      onPress={() => { tapHaptic("select"); onPress?.(); }}
      haptic={null}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={{
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
        backgroundColor: selected ? colors.ember : colors.surface,
        borderWidth: 1, borderColor: selected ? colors.ember : dark ? colors.rim : colors.border,
      }}
    >
      {icon ? <Sym name={icon} size={13} color={selected ? colors.onEmber : colors.textMuted} /> : null}
      <T kind="subMedium" color={selected ? colors.onEmber : colors.textSecondary}>{label}</T>
    </PressableScale>
  );
}

/** Horizontal chip rail helper. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}
