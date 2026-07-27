// "What's on this screen?" — offered once, then out of the way.
//
// Four things were reported about this chip, and they're all the same thing: it behaved like a
// permanent part of the furniture when it's meant to be an offer.
//
//   "On the calendar screen it's almost touching the calendar dates."
//   "It doesn't disappear if the user does not click on it. It should disappear within ten
//    seconds at a maximum."
//   "If they've clicked into an item it should disappear."
//   "It should only be shown to the user the first time that they walk through this app, log
//    into it, and start their household. Otherwise it should be saved in the settings, and
//    that's where the walkthrough will happen."
//
// So it is now genuinely an offer: it appears on a screen you haven't been offered it on
// before, waits ten seconds, and goes. Take it or ignore it — either way it doesn't come back,
// because the walkthrough lives in Settings and that's the durable way in. A control that
// reappears every visit isn't help, it's a nag, and people learn to look past exactly the
// region of the screen it occupies.
//
// "Seen" is remembered per screen and persisted, so it survives a relaunch. The alternative —
// in-memory — would re-offer the whole app on every cold start, which is the same nag with
// extra steps.
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import * as SecureStore from "expo-secure-store";
import { useTheme } from "@/theme";
import { useTutorial } from "@/lib/tutorial";
import { PressableScale } from "./pressable-scale";
import { Sym } from "./symbol";
import { T } from "./text";

const SEEN_KEY = "familios_tour_offered";
/** "It should disappear within, you know, ten seconds at a maximum." */
const LINGER_MS = 10_000;

/* Which screens have already made the offer. Loaded once per launch and written through, so a
 * relaunch doesn't start the nagging over. */
let seen: Set<string> | null = null;
async function loadSeen(): Promise<Set<string>> {
  if (seen) return seen;
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY);
    seen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { seen = new Set(); }
  return seen;
}
function markSeen(route: string) {
  seen = seen ?? new Set();
  if (seen.has(route)) return;
  seen.add(route);
  void SecureStore.setItemAsync(SEEN_KEY, JSON.stringify([...seen])).catch(() => {});
}

export function ScreenTour({ route }: { route: string }) {
  const { colors, spacing } = useTheme();
  const { hasChapter, startChapter, running } = useTutorial();
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    void loadSeen().then((s) => {
      if (!live || s.has(route) || !hasChapter(route)) return;
      setShow(true);
      // The offer stands for ten seconds and then withdraws itself. Marked as offered the
      // moment it's shown, not when it's dismissed — it was offered either way.
      markSeen(route);
      timer.current = setTimeout(() => { if (live) setShow(false); }, LINGER_MS);
    });
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [route, hasChapter]);

  // "If they've clicked into an item it should disappear" — a running walkthrough, or any
  // navigation away, takes it with them.
  useEffect(() => { if (running) setShow(false); }, [running]);

  if (!show || running || !hasChapter(route)) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(260).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(220).reduceMotion(ReduceMotion.System)}
      // J1 — "it's almost touching the calendar dates." Real room beneath it.
      style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.sm }}
    >
      <PressableScale
        onPress={() => { setShow(false); startChapter(route); }}
        haptic="select"
        accessibilityRole="button"
        accessibilityLabel="Show me what's on this screen"
        style={{
          flexDirection: "row", alignItems: "center", gap: 6,
          backgroundColor: colors.emberBg, borderRadius: 999,
          paddingHorizontal: 12, paddingVertical: 6,
        }}
      >
        <Sym name="question" size={13} color={colors.ember} />
        <T kind="subMedium" color={colors.ember}>What&apos;s this screen?</T>
      </PressableScale>
      <View style={{ width: 0 }} />
    </Animated.View>
  );
}
