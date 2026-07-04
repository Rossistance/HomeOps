import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "@/lib/session";
import { Body, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// The "More" hub: everything that isn't one of the four high-frequency tabs.
// New surfaces (Meals, Files, Playbooks, …) get a row here instead of a tab,
// so the tab bar stays calm as the app grows.
type Row = { icon: keyof typeof Ionicons.glyphMap; label: string; hint?: string; href: string };

const FAMILY: Row[] = [
  { icon: "restaurant-outline", label: "Meals", hint: "Week plan + groceries", href: "/meals" },
  { icon: "folder-open-outline", label: "Files & Knowledge", hint: "Shared documents + helper memory", href: "/files" },
  // "Recipes" mirrors the web IA: playbooks folded into a read-only reference view.
  { icon: "map-outline", label: "Recipes", hint: "Step-by-step household workflows", href: "/playbooks" },
  { icon: "people-outline", label: "Household", hint: "Members, roles, spaces & visibility", href: "/household" },
];
const SYSTEM: Row[] = [
  { icon: "pulse-outline", label: "Activity", hint: "Runs & audit trail", href: "/activity" },
  { icon: "link-outline", label: "Connections", hint: "Accounts & connectors", href: "/connections" },
  { icon: "settings-outline", label: "Settings", hint: "AI providers, session", href: "/settings" },
];

function NavRow({ row, divider }: { row: Row; divider: boolean }) {
  return (
    <Pressable
      style={[st.navRow, divider && st.navDivider]}
      onPress={() => router.push(row.href as never)}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      accessibilityHint={row.hint}>
      <Ionicons name={row.icon} size={19} color={Hearth.ink500} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Body style={{ fontWeight: "600" }}>{row.label}</Body>
        {row.hint ? <Muted style={{ fontSize: 12 }}>{row.hint}</Muted> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={Hearth.ink400} />
    </Pressable>
  );
}

export default function MoreScreen() {
  const { session } = useSession();
  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content}>
        <H1>More</H1>
        <Muted style={{ marginTop: 4 }}>{session?.actorName} · {session?.role}</Muted>

        {FAMILY.length > 0 && (
          <>
            <View style={{ marginTop: 20 }}><Eyebrow>Family</Eyebrow></View>
            <Card style={{ marginTop: 8, padding: 0 }}>
              {FAMILY.map((r, i) => <NavRow key={r.href} row={r} divider={i > 0} />)}
            </Card>
          </>
        )}

        <View style={{ marginTop: 20 }}><Eyebrow>System</Eyebrow></View>
        <Card style={{ marginTop: 8, padding: 0 }}>
          {SYSTEM.map((r, i) => <NavRow key={r.href} row={r} divider={i > 0} />)}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  navRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13 },
  navDivider: { borderTopWidth: 1, borderTopColor: Hearth.border },
});
