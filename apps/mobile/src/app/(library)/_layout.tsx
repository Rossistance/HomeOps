import { Stack } from "expo-router/stack";
import { useHearthStackOptions } from "@/lib/nav";

export default function LibraryLayout() {
  return (
    <Stack screenOptions={useHearthStackOptions()}>
      <Stack.Screen name="index" options={{ title: "Library" }} />
    </Stack>
  );
}
