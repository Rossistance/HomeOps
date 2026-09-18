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
import { TutorialProvider } from "@/lib/tutorial";
import { CoachMarks } from "@/components/CoachMarks";
import { ThemePrefProvider, OnboardingProvider, AdvancedModeProvider, useOnboarding } from "@/lib/prefs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installCrashReporting } from "@/lib/crash-reporter";
import { Lock } from "@/components/Lock";
import { Splash } from "@/components/Splash";
import { markAppVisible } from "@/lib/app-visible";
import { Onboarding } from "@/components/Onboarding";
import { useTheme } from "@/theme";
import { api } from "@/lib/api";
import { routeForNotification, type PushData } from "@/lib/notification-routing";

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

// Handoff IA: Today · Ask (sparkle) · Helpers (wand) · Library (folder) · Settings (gear).
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
        {/* "Agents" was a word from the architecture, and the architecture had seven of them.
            There is one thing now, and it is called what it does. */}
        <NativeTabs.Trigger.Label>Helpers</NativeTabs.Trigger.Label>
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

/** iOS notification categories: what a banner can do without opening the app. A family
 *  message can be answered from the lock screen; "Mark read" clears it. Registered once per
 *  launch; the server names the category on every thread push (categoryId). */
const FAMILY_MESSAGE_CATEGORY = "family_message";
async function registerCategories() {
  try {
    await Notifications.setNotificationCategoryAsync(FAMILY_MESSAGE_CATEGORY, [
      { identifier: "reply", buttonTitle: "Reply", textInput: { submitButtonTitle: "Send", placeholder: "Message" }, options: { opensAppToForeground: false } },
      { identifier: "mark_read", buttonTitle: "Mark read", options: { opensAppToForeground: false } },
    ]);
  } catch { /* categories are iOS/Android only */ }
}

/** A tap on a push goes to the thing it names; a Reply typed on the banner is sent without
 *  opening the UI (and queued if the network is down). */
async function handleResponse(response: Notifications.NotificationResponse) {
  const data = (response.notification.request.content.data ?? null) as PushData;
  if (response.actionIdentifier === "reply") {
    const text = String(response.userText ?? "").trim();
    if (data?.type === "thread" && data.id && text) await api.sendMessage(data.id, { text });
    return;
  }
  if (response.actionIdentifier === "mark_read") {
    if (data?.type === "thread" && data.id) await api.markThreadRead(data.id);
    return;
  }
  const route = routeForNotification(data);
  if (route) router.push({ pathname: route.pathname, params: route.params } as never);
}

function PushRegistrar() {
  const { session } = useSession();
  const registeredRef = useRef(false);

  // Taps and banner actions, for the life of the session; plus the response that launched
  // the app from cold, which arrives before any listener could be attached.
  useEffect(() => {
    if (!session) return;
    void registerCategories();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => { void handleResponse(r); });
    void Notifications.getLastNotificationResponseAsync().then((r) => { if (r) void handleResponse(r); }).catch(() => {});
    return () => { sub.remove(); };
  }, [session]);

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
      {/* Last, so it draws over the tabs. Renders nothing unless a walkthrough is running. */}
      <CoachMarks />
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
          {/* Inside SessionProvider because the walkthrough scopes itself by role, and above
              the navigator because the spotlight is drawn over whatever screen you're on. */}
          <TutorialProvider>
            <Gate />
          </TutorialProvider>
        </RunProvider>
      </SessionProvider>
      {/* markAppVisible is what starts anything that is meant to be WATCHED (the greeting's
          bloom) — see lib/app-visible. Screens mount under this thing. */}
      {!splashDone && <Splash onDone={() => { setSplashDone(true); markAppVisible(); }} />}
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
