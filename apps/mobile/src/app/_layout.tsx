import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { ActivityIndicator, StyleSheet, View, useColorScheme } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { ThemeProvider, DarkTheme, DefaultTheme } from "expo-router/react-navigation";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Fraunces_600SemiBold, Fraunces_700Bold } from "@expo-google-fonts/fraunces";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { SessionProvider, useSession } from "@/lib/session";
import { RunProvider } from "@/lib/run-context";
import { Lock } from "@/components/Lock";
import { lightColors, darkColors } from "@/theme";
import { api } from "@/lib/api";

void SplashScreen.preventAutoHideAsync();

// Show notifications when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

function TabsNav() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(calendar)">
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(ask)">
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
        <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(inbox)">
        <NativeTabs.Trigger.Icon sf="tray.fill" md="inbox" />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(more)">
        <NativeTabs.Trigger.Icon sf="ellipsis" md="more_horiz" />
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
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
  const scheme = useColorScheme();
  const c = scheme === "dark" ? darkColors : lightColors;
  if (loading) {
    return <View style={[st.splash, { backgroundColor: c.bg }]}><ActivityIndicator color={c.ember} size="large" /></View>;
  }
  if (!session) return <Lock />;
  return (
    <>
      <TabsNav />
      <PushRegistrar />
    </>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  const c = dark ? darkColors : lightColors;
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold, Fraunces_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });
  useEffect(() => { if (fontsLoaded) void SplashScreen.hideAsync(); }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: c.bg,
      card: c.surface,
      text: c.text,
      primary: c.ember,
      border: c.border,
    },
  };

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? "light" : "dark"} />
        <SessionProvider>
          <RunProvider>
            <Gate />
          </RunProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
});
