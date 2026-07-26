// Entrance choreography: content rises in with a gentle stagger. Collapses to
// nothing under reduced motion (ReduceMotion.System).
import type { ReactNode } from "react";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

export function Rise({ index = 0, children, style }: { index?: number; children: ReactNode; style?: object }) {
  return (
    <Animated.View
      /* Springified rather than eased. A cubic curve arrives and stops; a spring arrives and
       * settles, and at this distance (10pt) the difference is most of what separates
       * "animated" from "physical". Damping is high enough that it doesn't visibly bounce —
       * the overshoot is a few tenths of a point, felt rather than seen. Entrance only: this
       * is not `layout`, which is what caused the runaway scroll described below. */
      entering={FadeInDown.springify().damping(19).stiffness(190).delay(Math.min(index, 8) * 45).reduceMotion(ReduceMotion.System)}
      /* `layout={LinearTransition}` used to be here, on EVERY section of EVERY screen.
       *
       * Reported: "when I scroll down to the very bottom, sometimes this just keeps going. It
       * just keeps scrolling and scrolling and it does not stop. Sometimes it happens on every
       * screen." That "every screen" is the tell — Rise is on every screen, and it was the
       * only thing they all shared.
       *
       * A layout animation on a direct child of a ScrollView animates the child's height,
       * which changes the scroll view's content size, which lays out again — and with iOS's
       * automatic content-inset adjustment (HScreen sets both that and keyboard insets) that
       * can keep feeding itself. Sections here don't reorder, so the transition was buying
       * nothing and costing that.
       *
       * The entrance stagger — the actual design intent — is untouched.
       *
       * Honest caveat: I could not reproduce the runaway scroll directly, so this is the most
       * probable structural cause removed rather than a confirmed repro fixed. */
      style={style}
    >
      {children}
    </Animated.View>
  );
}
