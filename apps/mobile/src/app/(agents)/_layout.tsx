// Helpers. The route folder keeps its old name — deep links, the tab-swipe order
// (lib/tab-order) and anything already out in the world point at /(agents), and renaming the
// directory would break every one of them to tidy a path only the code reads. The word a
// person sees is the one that changed.
import { Stack } from "expo-router/stack";
import { TabSwipe } from "@/components/TabSwipe";
import { useHearthStackOptions } from "@/lib/nav";

export default function HelpersLayout() {
  return (
    <TabSwipe current="/(agents)">
      <Stack screenOptions={useHearthStackOptions()}>
        <Stack.Screen name="index" options={{ title: "Helpers", gestureEnabled: false }} />
        <Stack.Screen name="[id]" options={{ title: "", headerLargeTitle: false }} />
      </Stack>
    </TabSwipe>
  );
}
