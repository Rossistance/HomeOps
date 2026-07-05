// Standard screen scaffold: ScrollView with automatic safe-area insets,
// pull-to-refresh, and consistent content padding. First child of every route.
import type { ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useTheme } from "@/theme";

export function HScreen({ children, refreshing, onRefresh, bottomPad = 40 }: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomPad?: number;
}) {
  const { colors, spacing } = useTheme();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomPad, gap: spacing.md }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textFaint} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}
