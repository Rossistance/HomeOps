import { Stack } from "expo-router/stack";
import { TabSwipe } from "@/components/TabSwipe";
import { useHearthStackOptions } from "@/lib/nav";

export default function LibraryLayout() {
  return (
    <TabSwipe current="/(library)">
      <Stack screenOptions={useHearthStackOptions()}>
        <Stack.Screen name="index" options={{ title: "Library", gestureEnabled: false }} />
      </Stack>
    </TabSwipe>
  );
}
