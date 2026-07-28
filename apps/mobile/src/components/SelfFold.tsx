// You, folding up into the corner.
//
// "It would probably be better if there was some sort of animation that loaded these in and
//  aligned like cards, and then what happened is then I would somehow fold up in minima and
//  get smaller to this position, and then what would be left would be my family members.
//  That would give a better indication that I'm all good as me, these are the people in my
//  family, and I'm no longer in that line anymore."
//
// The static half of this shipped already (the strip excludes you, your avatar sits
// top-right). This is the sentence that connects the two: on the first paint of a session
// your face is still in the line with everyone else's, then it lifts, shrinks and settles
// into the corner — so the rearrangement is something you WATCH happen rather than a layout
// you have to infer.
//
// Three rules keep it from becoming an irritation:
//
//   ONCE PER LAUNCH. A transition that replays on every visit to Today is a hiccup, not a
//   welcome — and this one costs 900ms before the screen is still.
//
//   IT WAITS FOR THE SCREEN TO BE VISIBLE. Today mounts underneath the splash, so an
//   effect-triggered animation runs and finishes before anyone can see it (the same trap
//   that made the greeting bloom invisible — see lib/app-visible).
//
//   REDUCE MOTION WINS. Someone who has asked the system for less movement gets the end
//   state immediately, with no flight across the screen.
import { useEffect, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import Animated, {
  Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from "react-native-reanimated";
import { useReducedMotion } from "react-native-reanimated";
import { whenAppVisible } from "@/lib/app-visible";

/** Played once per launch, not once per mount — Today remounts on every tab return. */
let foldedThisLaunch = false;

export function SelfFold({ children, size = 34, stripSize = 48 }: {
  children: React.ReactNode;
  /** The resting size in the corner. */
  size?: number;
  /** The size it starts at, matching the member strip's avatars. */
  stripSize?: number;
}) {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const [done, setDone] = useState(foldedThisLaunch || reduced);

  // Distance from the corner back to roughly where your avatar sat in the strip: first cell,
  // one row down. Approximate on purpose — it reads as "from over there", and chasing the
  // exact pixel would mean measuring a list that hasn't laid out yet.
  const dx = useSharedValue(done ? 0 : -(width - 90));
  const dy = useSharedValue(done ? 0 : 96);
  const scale = useSharedValue(done ? 1 : stripSize / size);
  const opacity = useSharedValue(done ? 1 : 0);

  useEffect(() => {
    if (done) return;
    return whenAppVisible(() => {
      foldedThisLaunch = true;
      const ease = { duration: 620, easing: Easing.bezier(0.22, 1, 0.36, 1), reduceMotion: ReduceMotion.System };
      // A beat first, so the strip has settled and there is something to fold away FROM.
      opacity.value = withDelay(240, withTiming(1, { duration: 180, reduceMotion: ReduceMotion.System }));
      dx.value = withDelay(240, withTiming(0, ease));
      dy.value = withDelay(240, withTiming(0, ease));
      scale.value = withDelay(240, withTiming(1, ease));
      // Hand back to plain layout once it lands: an animated wrapper that stays animated is
      // a thing every later re-render has to think about.
      setTimeout(() => setDone(true), 900);
    });
  }, [done, dx, dy, scale, opacity, stripSize, size]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: dx.value }, { translateY: dy.value }, { scale: scale.value }],
  }));

  if (done) return <View>{children}</View>;
  return <Animated.View style={style}>{children}</Animated.View>;
}
