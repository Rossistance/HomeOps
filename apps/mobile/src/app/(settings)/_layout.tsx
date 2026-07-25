import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function SettingsLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="tasks" options={{ title: "Tasks & Lists" }} />
      <Stack.Screen name="meals" options={{ title: "Meals" }} />
      <Stack.Screen name="automations" options={{ title: "Automations" }} />
      <Stack.Screen name="playbooks" options={{ title: "Playbooks" }} />
      <Stack.Screen name="household" options={{ title: "Household" }} />
      <Stack.Screen name="contacts" options={{ title: "Contacts" }} />
      <Stack.Screen name="connections" options={{ title: "Connections" }} />
      <Stack.Screen name="ai" options={{ title: "AI Providers" }} />
      <Stack.Screen name="nests" options={{ title: "Nests" }} />
      {/* D5 — reachable only for the platform operator; the screen itself refuses everyone
          else, and the routes behind it 404. */}
      <Stack.Screen name="operator" options={{ title: "Operator" }} />
    </Stack>
  );
}
