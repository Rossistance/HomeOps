// Dictation, for every text field that takes a sentence.
//
// "I've added under the Ask portion a microphone. We need to add dictation to ALL chat input
//  interfaces — here and in the standalone page for the Ask… We need to add the dictation right
//  near the send button down here that allows for users to dictate."
//
// A component rather than a per-screen implementation, because "all chat input interfaces" is
// three places today and more later, and three copies of a permission flow is three chances to
// get the denial case wrong.
//
// WHY NOT JUST THE KEYBOARD MIC. iOS already has one — but it's a keyboard key, which means it
// only exists once the keyboard is up, it's absent on hardware keyboards, and on the Today card
// there is no keyboard at all because that card isn't a text field. A control the app owns can
// sit next to Send, where he drew it.
//
// INTERIM RESULTS ARE SHOWN AS THEY ARRIVE. Watching the words appear is what tells you it's
// listening; a mic that lights up and then produces a paragraph three seconds later feels
// broken even when it isn't. The final result replaces the interim text rather than appending
// to it, or you get every phrase twice.
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useTheme, tapHaptic } from "@/theme";
import { PressableScale } from "./pressable-scale";
import { Sym } from "./symbol";

/**
 * @param onText  Called with the transcript so far. The caller decides where it goes — the
 *                chat composer replaces its draft, a form field replaces its value.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  // What the field held before we started, so interim results extend it instead of erasing it.
  const baseRef = useRef("");

  useSpeechRecognitionEvent("result", (e) => {
    const said = e.results?.[0]?.transcript ?? "";
    if (!said) return;
    onText(`${baseRef.current}${baseRef.current && !baseRef.current.endsWith(" ") ? " " : ""}${said}`);
  });
  useSpeechRecognitionEvent("end", () => setListening(false));
  useSpeechRecognitionEvent("error", (e) => {
    setListening(false);
    // "no-speech" is someone tapping the mic and thinking — not a failure worth an alert.
    if (e.error === "no-speech" || e.error === "aborted") return;
    Alert.alert("Dictation stopped", e.message || "Try again in a moment.");
  });

  // Never leave the microphone open behind a screen the user has left.
  useEffect(() => () => { try { ExpoSpeechRecognitionModule.abort(); } catch { /* not running */ } }, []);

  const toggle = useCallback(async (currentText = "") => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      setListening(false);
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Dictation needs the microphone",
        "Turn on Microphone and Speech Recognition for FamiliOS in iOS Settings, then try again.",
      );
      return;
    }
    baseRef.current = currentText;
    tapHaptic("light");
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      // Words as they're spoken: the feedback IS the affordance.
      interimResults: true,
      continuous: false,
      // Punctuation makes a dictated message readable without editing it afterwards.
      addsPunctuation: true,
    });
  }, [listening]);

  return { listening, toggle };
}

/** The button. Pulses while it's listening, because a still mic looks like a dead one. */
export function DictateButton({
  listening, onPress, size = 44, tone, bg,
}: {
  listening: boolean;
  onPress: () => void;
  size?: number;
  tone?: string;
  bg?: string;
}) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!listening) { pulse.value = withTiming(0, { duration: 180, reduceMotion: ReduceMotion.System }); return; }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 620, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.System }),
        withTiming(0, { duration: 620, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.System }),
      ), -1, false, undefined, ReduceMotion.System,
    );
  }, [listening, pulse]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.08 }], opacity: 0.75 + pulse.value * 0.25 }));

  return (
    <PressableScale
      onPress={onPress}
      haptic={null}
      accessibilityRole="button"
      accessibilityState={{ selected: listening }}
      accessibilityLabel={listening ? "Stop dictating" : "Dictate"}
    >
      <Animated.View
        style={[{
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: listening ? colors.coralBg : (bg ?? colors.surfaceSunken),
          alignItems: "center", justifyContent: "center",
        }, a]}
      >
        <Sym name="mic" size={Math.round(size * 0.42)} color={listening ? colors.coral : (tone ?? colors.textSecondary)} />
      </Animated.View>
    </PressableScale>
  );
}
