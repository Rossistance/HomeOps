import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function HomeLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      {/* Today draws its own greeting header per the handoff. */}
      <Stack.Screen name="index" options={{ title: "Today", headerShown: false }} />
      <Stack.Screen name="activity" options={{ title: "Activity" }} />
      <Stack.Screen name="groceries" options={{ title: "Groceries" }} />
      <Stack.Screen name="kid" options={{ title: "", headerShown: false }} />
      <Stack.Screen name="grandparent" options={{ title: "", headerShown: false }} />
      <Stack.Screen name="calendar" options={{ title: "Calendar" }} />
      <Stack.Screen name="inbox" options={{ title: "Inbox" }} />
      <Stack.Screen
        name="event-form"
        options={{
          title: "Event",
          presentation: "formSheet",
          headerLargeTitle: false,
          sheetGrabberVisible: true,
          sheetAllowedDetents: [0.75, 1.0],
        }}
      />
    </Stack>
  );
}
