import { useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { ThemeProvider, DarkTheme, DefaultTheme } from "expo-router/react-navigation";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Newsreader_600SemiBold } from "@expo-google-fonts/newsreader";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { SessionProvider, useSession } from "@/lib/session";
import { RunProvider } from "@/lib/run-context";
import { ThemePrefProvider, OnboardingProvider, useOnboarding } from "@/lib/prefs";
import { Lock } from "@/components/Lock";
import { Splash } from "@/components/Splash";
import { Onboarding } from "@/components/Onboarding";
import { useTheme } from "@/theme";
import { api } from "@/lib/api";

void SplashScreen.preventAutoHideAsync();

// Launch on Today — without this, expo-router anchors the alphabetically-first
// route group, which is (agents).
export const unstable_settings = { initialRouteName: "(home)" };

// Show notifications when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

// Handoff IA: Today · Ask (sparkle) · Agents (bot) · Library (folder) · Settings (gear).
function TabsNav() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(ask)">
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
        <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(agents)">
        <NativeTabs.Trigger.Icon sf="cpu" md="smart_toy" />
        <NativeTabs.Trigger.Label>Agents</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)">
        <NativeTabs.Trigger.Icon sf="folder.fill" md="folder" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
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
  if (loading || !obLoaded) {
    return <View style={[st.splash, { backgroundColor: colors.bg }]}><ActivityIndicator color={colors.ember} size="large" /></View>;
  }
  if (!session) return <Lock />;
  if (!onboarded) return <Onboarding />;
  return (
    <>
      <TabsNav />
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
    <SafeAreaProvider>
      <ThemePrefProvider>
        <OnboardingProvider>
          <Shell />
        </OnboardingProvider>
      </ThemePrefProvider>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
});
