// Loading skeletons: soft pulsing blocks in place of content (never bare spinners
// for full screens). Pulse stills automatically under reduced motion.
import { useEffect } from "react";
import { View, type DimensionValue } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, ReduceMotion } from "react-native-reanimated";
import { useTheme } from "@/theme";
import { cardStyle } from "./card";

export function Skeleton({ width = "100%", height = 16, radius = 8, style }: { width?: DimensionValue; height?: number; radius?: number; style?: object }) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 800, reduceMotion: ReduceMotion.System }), -1, true);
  }, [pulse]);
  const a = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceSunken }, a, style]} />;
}

/** Standard "list is loading" placeholder: N skeleton cards. */
export function SkeletonCards({ count = 3, lines = 2 }: { count?: number; lines?: number }) {
  const { colors, dark, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[cardStyle(colors, dark), { padding: spacing.lg, gap: 10 }]}>
          <Skeleton width="55%" height={17} />
          {Array.from({ length: lines }, (_, j) => (
            <Skeleton key={j} width={j === lines - 1 ? "70%" : "92%"} height={12} />
          ))}
        </View>
      ))}
    </View>
  );
}
