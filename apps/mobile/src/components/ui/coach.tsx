// <Coach id="…"> — "the tutorial may point at this."
//
// Wrapping a control in one of these is the entire contract a screen has with the walkthrough.
// It doesn't change layout, doesn't change behaviour, and doesn't know a tour exists; it just
// answers "where are you, right now, on this device" when asked.
//
// Deliberately a measurement rather than a registration of intent. A screen can't promise that
// a control is visible — the role might hide it, a list might be empty, the user might have
// scrolled — but it can always answer where the control IS, or fail to answer because it isn't
// mounted. The tutorial treats a non-answer as "not for this person" and moves on, which is how
// role scoping works without a second table of who-sees-what.
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTutorial, type CoachRect } from "@/lib/tutorial";

export function Coach({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { register } = useTutorial();
  const ref = useRef<View>(null);

  const measure = useCallback((): Promise<CoachRect | null> => new Promise((resolve) => {
    const node = ref.current;
    if (!node) return resolve(null);
    // measureInWindow, not measure: the tutorial's overlay is absolutely positioned against the
    // window, so a parent-relative box would land in the wrong place inside any scroll view.
    node.measureInWindow((x, y, width, height) => {
      // Off-screen or collapsed reads as "not here". A control scrolled out of view is not
      // something to draw a spotlight around.
      if (width <= 0 || height <= 0 || y < -height) return resolve(null);
      resolve({ x, y, width, height });
    });
    // measureInWindow never calls back if the node has gone; don't hang the tour on it.
    setTimeout(() => resolve(null), 400);
  }), []);

  useEffect(() => register(id, measure), [id, register, measure]);

  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}
