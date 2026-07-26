// "What's on this screen?"
//
// The app-wide walkthrough answers "what is this app". This answers "what is THIS screen", which
// is the question you actually have while standing on one — a different question, so it gets its
// own entry point rather than a longer spine.
//
// It renders NOTHING on a screen with no chapter. That's the important part: the alternative is
// a button that's always there and sometimes apologises, and a control that might do nothing is
// worse than no control. A screen earns this by having a chapter written for it.
import { View } from "react-native";
import { useTheme } from "@/theme";
import { useTutorial } from "@/lib/tutorial";
import { PressableScale } from "./pressable-scale";
import { Sym } from "./symbol";
import { T } from "./text";

export function ScreenTour({ route }: { route: string }) {
  const { colors, spacing } = useTheme();
  const { hasChapter, startChapter, running } = useTutorial();
  // Hidden while a walkthrough is already running — otherwise the tour spotlights a button that
  // restarts the tour, which is a small hall of mirrors.
  if (running || !hasChapter(route)) return null;
  return (
    <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
      <PressableScale
        onPress={() => startChapter(route)}
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
    </View>
  );
}
