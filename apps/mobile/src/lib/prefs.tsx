// Small persisted preferences: appearance override + first-run onboarding flag.
// SecureStore keeps these on-device; both default to "unset".
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { ThemePrefContext, type ThemePref } from "@/theme";

const THEME_KEY = "familios_theme_pref";
const ONBOARDED_KEY = "familios_onboarded";

export function ThemePrefProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("system");
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
