import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { ThemeProvider, DarkTheme, DefaultTheme } from "expo-router/react-navigation";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Newsreader_600SemiBold } from "@expo-google-fonts/newsreader";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { SessionProvider, useSession } from "@/lib/session";
import { capabilitiesFor, type Capabilities } from "@/lib/roles";
import { RunProvider } from "@/lib/run-context";
import { ThemePrefProvider, OnboardingProvider, AdvancedModeProvider, useOnboarding } from "@/lib/prefs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installCrashReporting } from "@/lib/crash-reporter";
import { Lock } from "@/components/Lock";
import { Splash } from "@/components/Splash";
import { Onboarding } from "@/components/Onboarding";
import { useTheme } from "@/theme";
import { api } from "@/lib/api";

// Installed at module scope so a crash during the FIRST render is still reported —
// a handler wired up inside a component is too late for exactly the worst case.
installCrashReporting();

void SplashScreen.preventAutoHideAsync();

// Launch on Today — without this, expo-router anchors the alphabetically-first
// route group, which is (agents).
export const unstable_settings = { initialRouteName: "(home)" };

// Show notifications when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

// Handoff IA: Today · Ask (sparkle) · Agents (bot) · Library (folder) · Settings (gear).
// The trigger set is role-scoped: children see Today (plus Ask when an adult enabled
// AI for them); grandparents/sitters see Today + Ask; adults/owners see all five.
function TabsNav({ caps }: { caps: Capabilities }) {
  // Today is home base. unstable_settings.initialRouteName doesn't anchor
  // NativeTabs (it kept opening the alphabetically-first group, (agents)),
  // so force the selection once on mount — before first paint.
  const anchored = useRef(false);
  useLayoutEffect(() => {
    if (anchored.current) return;
    anchored.current = true;
    router.replace("/(home)");
  }, []);

  const fullNav = caps.viewMode === "adult" || caps.viewMode === "owner";
  // Built as an array so the trigger set can vary by role (conditional JSX
  // children inside NativeTabs are less predictable than an explicit list).
  const triggers = [
    <NativeTabs.Trigger key="(home)" name="(home)">
      <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>,
  ];
  if (caps.canUseAI) {
    triggers.push(
      <NativeTabs.Trigger key="(ask)" name="(ask)">
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
        <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>,
    );
  }
  if (fullNav) {
    triggers.push(
      <NativeTabs.Trigger key="(agents)" name="(agents)">
        {/* NativeTabs renders a real UITabBar, so its icons must be SF Symbol or Material
            names — custom art can't go here, unlike everywhere else in the app (ui/glyph).
            What it CAN be is a better-chosen symbol: `cpu` drew a literal microchip, which
            said "hardware" about the one part of the app that's meant to feel like help. */}
        <NativeTabs.Trigger.Icon sf="wand.and.stars" md="auto_fix_high" />
        <NativeTabs.Trigger.Label>Agents</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>,
      <NativeTabs.Trigger key="(library)" name="(library)">
        <NativeTabs.Trigger.Icon sf="folder.fill" md="folder" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>,
      <NativeTabs.Trigger key="(settings)" name="(settings)">
        <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>,
    );
  }
  return <NativeTabs>{triggers}</NativeTabs>;
}

function PushRegistrar() {
  const { session } = useSession();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!session || registeredRef.current) return;
    registeredRef.current = true;
    void (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        const final = existing === "granted" ? existing : (await Notifications.requestPermissionsAsync()).status;
        if (final !== "granted") return;
        const tokenData = await Notifications.getExpoPushTokenAsync();
        await api.registerPushToken(tokenData.data);
      } catch { /* push unsupported (simulator / web) — skip silently */ }
    })();
  }, [session]);

  return null;
}

function Gate() {
  const { loading, session } = useSession();
  const { loaded: obLoaded, onboarded } = useOnboarding();
  const { colors } = useTheme();
  // Role-scoped logins: resolve the signed-in member ONCE so the tab bar (and the
  // home each role lands on) matches their capabilities — a child or sitter never
  // gets the full admin navigation. The server still enforces everything.
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const actorId = session?.actorId ?? null;
  useEffect(() => {
    if (!actorId) { setCaps(null); return; }
    let cancelled = false;
    void (async () => {
      const members = await api.members();
      if (cancelled) return;
      const me = members.find((m) => m.isCurrentUser) ?? members.find((m) => m.actorId === actorId) ?? null;
      setCaps(capabilitiesFor(me));
    })();
    return () => { cancelled = true; };
  }, [actorId]);

  if (loading || !obLoaded) {
    return <View style={[st.splash, { backgroundColor: colors.bg }]}><ActivityIndicator color={colors.ember} size="large" /></View>;
  }
  if (!session) return <Lock />;
  if (!onboarded) return <Onboarding />;
  if (!caps) {
    return <View style={[st.splash, { backgroundColor: colors.bg }]}><ActivityIndicator color={colors.ember} size="large" /></View>;
  }
  return (
    <>
      <TabsNav caps={caps} />
      <PushRegistrar />
    </>
  );
}

function Shell() {
  const { dark, colors } = useTheme();
  // Animated brand splash, once per cold start, over everything.
  const [splashDone, setSplashDone] = useState(false);

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      primary: colors.ember,
      border: colors.border,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={dark || !splashDone ? "light" : "dark"} />
      <SessionProvider>
        <RunProvider>
          <Gate />
        </RunProvider>
      </SessionProvider>
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Newsreader_600SemiBold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });
  useEffect(() => { if (fontsLoaded) void SplashScreen.hideAsync(); }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  return (
    // ErrorBoundary is the OUTERMOST wrapper on purpose: a provider that throws during
    // render would otherwise take the whole tree down to a white screen with no report.
    <ErrorBoundary screen="root">
      {/* Gestures need this at the root or they silently never fire — which is how a
          drag-to-resize ships looking like it simply doesn't work. It sits INSIDE the error
          boundary (so a throw is still caught) and OUTSIDE the providers, because everything
          below it may want a gesture. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemePrefProvider>
          <OnboardingProvider>
            <AdvancedModeProvider>
              <Shell />
            </AdvancedModeProvider>
          </OnboardingProvider>
        </ThemePrefProvider>
      </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const st = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
});
