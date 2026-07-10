import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function AskLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      {/* Chat owns its own header row (conversation picker); keep the native bar compact. */}
      <Stack.Screen name="index" options={{ title: "Ask Famili", headerLargeTitle: false }} />
    </Stack>
  );
}
