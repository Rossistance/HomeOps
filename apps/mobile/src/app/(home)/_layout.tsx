import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function HomeLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="activity" options={{ title: "Activity" }} />
    </Stack>
  );
}
