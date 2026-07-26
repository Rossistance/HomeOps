// Small persisted preferences: appearance override + first-run onboarding flag.
// SecureStore keeps these on-device; both default to "unset".
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { ThemePrefContext, type ThemePref } from "@/theme";

const THEME_KEY = "familios_theme_pref";
const ONBOARDED_KEY = "familios_onboarded";
const ADVANCED_KEY = "familios_advanced_mode";

export function ThemePrefProvider({ children }: { children: ReactNode }) {
  /* Dark is what FamiliOS ships as. Asked for directly, and it's the right default for what
   * this is: a household app people open in the evening, at the kitchen table, in bed — a
   * full-brightness cream page at 11pm is a worse first impression than a dark one at noon.
   *
   * Still only a DEFAULT. Anyone who picks light, dark or system in Settings gets what they
   * picked, forever; this is the answer before anyone has answered. */
  const [pref, setPrefState] = useState<ThemePref>("dark");
  useEffect(() => {
    void (async () => {
      try {
        const v = await SecureStore.getItemAsync(THEME_KEY);
        if (v === "light" || v === "dark" || v === "system") setPrefState(v);
      } catch { /* first run */ }
    })();
  }, []);
  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    void SecureStore.setItemAsync(THEME_KEY, p).catch(() => {});
  }, []);
  return <ThemePrefContext.Provider value={{ pref, setPref }}>{children}</ThemePrefContext.Provider>;
}

interface OnboardingState {
  loaded: boolean;
  onboarded: boolean;
  setOnboarded: (v: boolean) => void;
}

const OnboardingContext = createContext<OnboardingState>({ loaded: false, onboarded: true, setOnboarded: () => {} });

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [onboarded, setOnboardedState] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const v = await SecureStore.getItemAsync(ONBOARDED_KEY);
        setOnboardedState(v === "1");
      } catch {
        setOnboardedState(false);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);
  const setOnboarded = useCallback((v: boolean) => {
    setOnboardedState(v);
    void SecureStore.setItemAsync(ONBOARDED_KEY, v ? "1" : "0").catch(() => {});
  }, []);
  return <OnboardingContext.Provider value={{ loaded, onboarded, setOnboarded }}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() { return useContext(OnboardingContext); }

// Advanced Mode — a personal, on-device view preference (mirrors the web's
// "homeops:advanced-mode"). OFF by default: the raw Activity log and the
// "What I did" run history stay hidden behind it, so a plain family device
// shows only the calm surfaces. Any role may turn it on for themselves.
interface AdvancedModeState {
  advanced: boolean;
  setAdvanced: (v: boolean) => void;
}

const AdvancedModeContext = createContext<AdvancedModeState>({ advanced: false, setAdvanced: () => {} });

export function AdvancedModeProvider({ children }: { children: ReactNode }) {
  const [advanced, setAdvancedState] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const v = await SecureStore.getItemAsync(ADVANCED_KEY);
        setAdvancedState(v === "1");
      } catch { /* first run: stays off, the safe default */ }
    })();
  }, []);
  const setAdvanced = useCallback((v: boolean) => {
    setAdvancedState(v);
    void SecureStore.setItemAsync(ADVANCED_KEY, v ? "1" : "0").catch(() => {});
  }, []);
  return <AdvancedModeContext.Provider value={{ advanced, setAdvanced }}>{children}</AdvancedModeContext.Provider>;
}

export function useAdvancedMode() { return useContext(AdvancedModeContext); }
