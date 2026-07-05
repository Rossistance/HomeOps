import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function MoreLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      <Stack.Screen name="index" options={{ title: "More" }} />
      <Stack.Screen name="tasks" options={{ title: "Tasks & Lists" }} />
      <Stack.Screen name="meals" options={{ title: "Meals" }} />
      <Stack.Screen name="agents" options={{ title: "Agents" }} />
      <Stack.Screen name="automations" options={{ title: "Automations" }} />
      <Stack.Screen name="files" options={{ title: "Files & Knowledge" }} />
      <Stack.Screen name="playbooks" options={{ title: "Playbooks" }} />
      <Stack.Screen name="household" options={{ title: "Household" }} />
      <Stack.Screen name="contacts" options={{ title: "Contacts" }} />
      <Stack.Screen name="connections" options={{ title: "Connections" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}
