// Entrance choreography: content rises in with a gentle stagger. Collapses to
// nothing under reduced motion (ReduceMotion.System).
import type { ReactNode } from "react";
import Animated, { FadeInDown, LinearTransition, ReduceMotion } from "react-native-reanimated";

export function Rise({ index = 0, children, style }: { index?: number; children: ReactNode; style?: object }) {
  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(Math.min(index, 8) * 45).reduceMotion(ReduceMotion.System)}
      layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
