import { Stack } from "expo-router/stack";
import { TabSwipe } from "@/components/TabSwipe";
import { useHearthStackOptions } from "@/lib/nav";

export default function SettingsLayout() {
  return (
    <TabSwipe current="/(settings)">
      <Stack screenOptions={useHearthStackOptions()}>
        <Stack.Screen name="index" options={{ title: "Settings", gestureEnabled: false }} />
        {/* Automations and Playbooks are gone: a schedule is a field on a Helper now, and a
            playbook was a helper with a different name. Both live on the Helpers tab. */}
        <Stack.Screen name="household" options={{ title: "Household" }} />
        <Stack.Screen name="contacts" options={{ title: "Contacts" }} />
        <Stack.Screen name="connections" options={{ title: "Connections" }} />
        <Stack.Screen name="ai" options={{ title: "AI Providers" }} />
        <Stack.Screen name="nests" options={{ title: "Nests" }} />
        {/* D5 — reachable only for the platform operator; the screen itself refuses everyone
            else, and the routes behind it 404. */}
        <Stack.Screen name="operator" options={{ title: "Operator" }} />
      </Stack>
    </TabSwipe>
  );
}
