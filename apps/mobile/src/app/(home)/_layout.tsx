import { Stack } from "expo-router/stack";
import { TabSwipe } from "@/components/TabSwipe";
import { useHearthStackOptions } from "@/lib/nav";

export default function HomeLayout() {
  return (
    <TabSwipe current="/(home)">
      <Stack screenOptions={useHearthStackOptions()}>
        {/* Today draws its own greeting header per the handoff. */}
        <Stack.Screen name="index" options={{ title: "Today", headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="activity" options={{ title: "Activity" }} />
        <Stack.Screen name="groceries" options={{ title: "Groceries" }} />
        <Stack.Screen name="kid" options={{ title: "", headerShown: false }} />
        <Stack.Screen name="grandparent" options={{ title: "", headerShown: false }} />
        <Stack.Screen name="sitter" options={{ title: "", headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: "My Profile" }} />
        <Stack.Screen name="help" options={{ title: "Ask or offer help" }} />
        <Stack.Screen name="calendar" options={{ title: "Calendar" }} />
        <Stack.Screen name="inbox" options={{ title: "Inbox" }} />
        <Stack.Screen
          name="event-form"
          options={{
            title: "Event",
            presentation: "formSheet",
            headerLargeTitle: false,
            sheetGrabberVisible: true,
            // C2 — [10:25] "It only raises about halfway. It should raise all the way to the
            // top and use the full screen." The 0.75 detent was the default it opened at, and
            // it's gone rather than merely deprioritised: leaving it in means one stray drag
            // puts the form back in the half-height state he was complaining about.
            sheetAllowedDetents: [1.0],
          }}
        />
      </Stack>
    </TabSwipe>
  );
}
