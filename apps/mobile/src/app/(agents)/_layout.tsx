import { Stack } from "expo-router/stack";
import { TabSwipe } from "@/components/TabSwipe";
import { useHearthStackOptions } from "@/lib/nav";

export default function AgentsLayout() {
  return (
    <TabSwipe current="/(agents)">
      <Stack screenOptions={useHearthStackOptions()}>
        <Stack.Screen name="index" options={{ title: "Agents", gestureEnabled: false }} />
        <Stack.Screen name="[id]" options={{ title: "", headerLargeTitle: false }} />
      </Stack>
    </TabSwipe>
  );
}
