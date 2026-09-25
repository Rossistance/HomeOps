// Badge (status pill) and Chip (selectable filter). Status colors keep meaning:
// sage=done, amber=pending/warning, coral=attention, sky=info, lavender=sensitive.
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme, tapHaptic } from "@/theme";
import { depth, softSurface } from "@/theme/neumorph";
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

export function Chip({ label, selected, onPress, onLongPress, icon, testID, accessibilityLabel }: { label: string; selected?: boolean; onPress?: () => void; onLongPress?: () => void; icon?: string; testID?: string; accessibilityLabel?: string }) {
  const { colors, dark } = useTheme();
  return (
    <PressableScale
      onPress={() => { tapHaptic("select"); onPress?.(); }}
      onLongPress={onLongPress}
      haptic={null}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={{
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
        backgroundColor: selected ? colors.ember : softSurface(colors, dark),
        borderWidth: 1, borderColor: selected ? colors.ember : dark ? colors.rim : colors.border,
        /* Selected reads as pressed IN, unselected as raised out — the same on/off physics as
         * every other control here, so "which one is chosen" is answered by depth as well as
         * by colour. That matters where the chip row is the whole navigation. */
        boxShadow: selected
          ? depth("insetSm", colors, dark)
          : depth("raisedSm", colors, dark),
      }}
    >
      {icon ? <Sym name={icon} size={14} color={selected ? colors.onEmber : colors.textMuted} /> : null}
      <T kind="subMedium" color={selected ? colors.onEmber : colors.textSecondary}>{label}</T>
    </PressableScale>
  );
}

/** Horizontal chip rail helper. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}
