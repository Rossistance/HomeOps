import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function CalendarLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      <Stack.Screen name="index" options={{ title: "Calendar" }} />
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
