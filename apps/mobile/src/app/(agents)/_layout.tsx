import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function AgentsLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      <Stack.Screen name="index" options={{ title: "Agents" }} />
      <Stack.Screen name="[id]" options={{ title: "", headerLargeTitle: false }} />
    </Stack>
  );
}
