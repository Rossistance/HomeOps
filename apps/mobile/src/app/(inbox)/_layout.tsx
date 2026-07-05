import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function InboxLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      <Stack.Screen name="index" options={{ title: "Inbox" }} />
    </Stack>
  );
}
