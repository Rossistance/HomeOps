// Show me around — the coach-mark engine.
//
// "A quick interactive tutorial mode, so users can go to Settings and get a walkthrough of the
//  app's features, like some apps do where it points you in the right direction. Available in
//  all modes, but scoped per user role and screens."
//
// TWO DECISIONS THAT SHAPE EVERYTHING ELSE.
//
// It points at the REAL screen. Not a slideshow, not a replica, not a scripted demo with
// invented events on it — the actual control, in place, with this household's actual data
// beside it. A tour of a fake app teaches the tour. It also means "available in all modes"
// costs nothing: the spotlight lands on whatever is genuinely there, in whatever theme, for
// whatever role, because it is measuring the thing rather than describing it.
//
// A step whose target isn't on screen is SKIPPED, never faked. That does most of the "scoped
// per user role" work without a second table of who-sees-what: a control an Adult Member can't
// see is a control that doesn't measure, so its step quietly isn't part of their tour. A
// parallel role→steps table would work right up until the day the two drifted, and then it
// would point someone at a button that isn't there — worse than no tutorial at all.
//
// The ONE thing measurement can't do is pick the tour. A child, grandparent or sitter gets a
// different SCREEN, not the adult Today with pieces removed, so the spine's targets are absent
// rather than filtered — measure them all and you get an empty tour. So view mode selects
// between two lists, and everything finer-grained than that stays measurement's job.
//
// The mechanism: a screen wraps a control in <Coach id="…">, which reports where that control
// actually is. The walkthrough asks for a position when it needs one. Nothing is registered
// until it's mounted, so "is this on screen for this person" is answered by measurement rather
// than by assumption.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import { useSession } from "@/lib/session";
import { capabilitiesFor } from "@/lib/roles";
import { tourFor, type TourStep } from "@/lib/tour-steps";

export interface CoachRect { x: number; y: number; width: number; height: number }
type Measurer = () => Promise<CoachRect | null>;
export type { TourStep };

/* -------------------------------- the context --------------------------------- */

interface TutorialApi {
  running: boolean;
  step: TourStep | null;
  index: number;
  /** How many steps have been shown so far. See the note on `shown` — there's no honest total. */
  shown: number;
  /** True when this is the last step in the list (whatever else got skipped along the way). */
  onLast: boolean;
  rect: CoachRect | null;
  /** A start that found nothing to point at. The overlay says so instead of nothing happening. */
  empty: boolean;
  start: () => void;
  next: () => void;
  stop: () => void;
  /** Called by <Coach> to register where it is. Returns an unregister fn. */
  register: (id: string, measure: Measurer) => () => void;
}

const Ctx = createContext<TutorialApi | null>(null);

export function useTutorial(): TutorialApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTutorial outside TutorialProvider");
  return c;
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const caps = useMemo(() => capabilitiesFor(session ? { role: session.role } : null), [session]);
  const targets = useRef(new Map<string, Measurer>());
  const [index, setIndex] = useState(-1);
  const [rect, setRect] = useState<CoachRect | null>(null);
  // Whether a start found nothing to point at — surfaced rather than swallowed.
  const [empty, setEmpty] = useState(false);
  /* How many bubbles have actually been SHOWN. A step whose target isn't on this person's
   * screen is skipped, so `steps.length` is an upper bound, not a count — "Step 3 of 8" that
   * jumps to 6 and finishes there is a small lie in a feature whose whole premise is pointing
   * at what's really there. This counts what you've seen; there is no denominator, because it
   * isn't knowable until the tour has walked the screens. */
  const [shown, setShown] = useState(0);
  const runId = useRef(0);
  // The route the tour last navigated to, so it doesn't re-push the one it's already on.
  const routeRef = useRef<string | null>(null);

  const steps = useMemo(() => tourFor(caps.viewMode), [caps.viewMode]);

  const register = useCallback((id: string, measure: Measurer) => {
    targets.current.set(id, measure);
    return () => {
      // Only delete our own entry: a screen remounting can register before the old one cleans
      // up, and blindly deleting would drop the live measurer.
      if (targets.current.get(id) === measure) targets.current.delete(id);
    };
  }, []);

  /**
   * Move to the first step at or after `from` whose target can actually be found, and measure
   * it. Ends the tour if nothing is left.
   *
   * Each attempt gets a short grace period: after a route change the target's screen needs a
   * frame or two to mount and lay out, and asking once immediately would skip a step that was
   * about to exist. The grace is bounded — an unfindable target ends up skipped rather than
   * hanging the tour on a control that is never coming.
   */
  const go = useCallback(async (from: number) => {
    const myRun = ++runId.current;
    let at = routeRef.current;
    for (let i = from; i < steps.length; i++) {
      const s = steps[i];
      // Only navigate when the route actually CHANGES. Five consecutive steps on Today used to
      // push Today five times, stacking five screens that Back then had to walk out of.
      if (s.route && s.route !== at) {
        at = s.route;
        routeRef.current = s.route;
        router.navigate(s.route as never);
      }
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 220 : 120));
        if (runId.current !== myRun) return; // stopped, or restarted underneath us
        const m = targets.current.get(s.target);
        const r = m ? await m() : null;
        if (r && r.width > 0 && r.height > 0) {
          setIndex(i);
          setRect(r);
          setShown((n) => n + 1);
          return;
        }
      }
      // Not on this person's screen — that's the role scoping doing its job. Try the next.
    }
    setIndex(-1);
    setRect(null);
    /* Nothing found at all. Almost certainly a screen that hasn't been given any Coach targets
     * yet, and the wrong answer is to do nothing: "Show me around" that silently does nothing
     * is indistinguishable from a broken button. Say so, once, and only for a start rather
     * than for reaching the end. */
    if (from === 0) setEmpty(true);
  }, [steps]);

  const start = useCallback(() => {
    setEmpty(false); setRect(null); setShown(0);
    // Forget where the tour last was. Between runs the user may have navigated anywhere, so a
    // stale value here would skip the navigation that the first step actually needs.
    routeRef.current = null;
    void go(0);
  }, [go]);
  const next = useCallback(() => { void go(index + 1); }, [go, index]);
  const stop = useCallback(() => { runId.current++; setIndex(-1); setRect(null); setEmpty(false); setShown(0); }, []);

  const api = useMemo<TutorialApi>(() => ({
    running: index >= 0,
    step: index >= 0 ? steps[index] : null,
    index,
    shown,
    onLast: index >= 0 && index >= steps.length - 1,
    rect,
    empty,
    start, next, stop, register,
  }), [index, steps, shown, rect, empty, start, next, stop, register]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
