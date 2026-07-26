// Tactile press feedback: springs to 97% scale while pressed. The whole app
// routes presses through this so everything answers the finger the same way.
import { forwardRef, type ReactNode } from "react";
import { Pressable, type PressableProps, type View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, ReduceMotion } from "react-native-reanimated";
import { tapHaptic } from "@/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends PressableProps {
  children?: ReactNode;
  /** Haptic to fire on press-in; null disables. Default "light". */
  haptic?: Parameters<typeof tapHaptic>[0] | null;
  scaleTo?: number;
}

export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  { haptic = "light", scaleTo = 0.97, onPressIn, onPressOut, style, ...rest }, ref,
) {
  const scale = useSharedValue(1);
  /* Soft UI presses DOWN. The reference's pressed state is translate-y plus an inset shadow;
   * box-shadow can't be animated on the UI thread here, so the press is carried by the two
   * things that can — a compress and a real downward shift. Half a point is enough: what
   * sells a press is that the surface moves toward the finger, not how far. */
  const sink = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: sink.value }],
  }));
  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      style={[animated, style as object]}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, { damping: 20, stiffness: 400, reduceMotion: ReduceMotion.System });
        sink.value = withSpring(1, { damping: 20, stiffness: 420, reduceMotion: ReduceMotion.System });
        if (haptic) tapHaptic(haptic);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 16, stiffness: 320, reduceMotion: ReduceMotion.System });
        sink.value = withSpring(0, { damping: 15, stiffness: 300, reduceMotion: ReduceMotion.System });
        onPressOut?.(e);
      }}
    />
  );
});
