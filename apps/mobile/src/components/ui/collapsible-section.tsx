// Collapsible section: a SectionHeader-style row with an item count and a
// chevron that toggles its children — the same expand/collapse idiom the
// Library uses for artifacts, lifted into a reusable piece.
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useTheme, tapHaptic } from "@/theme";
import { PressableScale } from "./pressable-scale";
import { T } from "./text";
import { Sym } from "./symbol";
import { Badge } from "./badge";

export function CollapsibleSection({ title, count, defaultOpen = false, children }: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { colors, spacing } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View>
      <PressableScale
        onPress={() => { tapHaptic("select"); setOpen((o) => !o); }}
        haptic={null}
        scaleTo={0.99}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${count != null ? `, ${count} item${count === 1 ? "" : "s"}` : ""}${open ? ", collapse" : ", expand"}`}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T kind="eyebrow">{title}</T>
          {count != null ? <Badge label={String(count)} fg={colors.textMuted} bg={colors.surfaceSunken} /> : null}
        </View>
        <Sym name={open ? "chevron.up" : "chevron.down"} size={13} color={colors.textFaint} />
      </PressableScale>
      {open ? <View style={{ gap: spacing.md }}>{children}</View> : null}
    </View>
  );
}
