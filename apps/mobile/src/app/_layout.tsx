import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { ActivityIndicator, StyleSheet, View, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "@/lib/session";
import { RunProvider } from "@/lib/run-context";
import { Lock } from "@/components/Lock";
import { Hearth } from "@/constants/hearth";
import { api } from "@/lib/api";

// Show notifications when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

function tabIcon(name: keyof typeof Ionicons.glyphMap) {
  const Icon = ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color} size={size} />;
  Icon.displayName = `TabIcon(${name})`;
  return Icon;
}

function TabsNav() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Hearth.ember600,
        tabBarInactiveTintColor: Hearth.ink400,
        tabBarStyle: { backgroundColor: Hearth.surface, borderTopColor: Hearth.border },
      }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home-outline") }} />
      <Tabs.Screen name="assistant" options={{ title: "Ask", tabBarIcon: tabIcon("sparkles-outline") }} />
      <Tabs.Screen name="calendar" options={{ title: "Calendar", tabBarIcon: tabIcon("calendar-outline") }} />
      <Tabs.Screen name="approvals" options={{ title: "Approvals", tabBarIcon: tabIcon("shield-checkmark-outline") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: tabIcon("grid-outline") }} />
      {/* Reachable from the More hub (and deep links), not the tab bar. */}
      <Tabs.Screen name="activity" options={{ href: null }} />
      <Tabs.Screen name="connections" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="meals" options={{ href: null }} />
      <Tabs.Screen name="files" options={{ href: null }} />
      <Tabs.Screen name="playbooks" options={{ href: null }} />
      <Tabs.Screen name="household" options={{ href: null }} />
    </Tabs>
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
  return (
    <View style={{ flex: 1, backgroundColor: Hearth.paper }}>
      <TabsNav />
      <PushRegistrar />
      {(loading || !session) && (
        <View style={StyleSheet.absoluteFill}>
          {loading ? (
            <View style={st.splash}><ActivityIndicator color={Hearth.ember500} size="large" /></View>
          ) : (
            <Lock />
          )}
        </View>
      )}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider>
        <RunProvider>
          <Gate />
        </RunProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  splash: { flex: 1, backgroundColor: Hearth.paper, alignItems: "center", justifyContent: "center" },
});
