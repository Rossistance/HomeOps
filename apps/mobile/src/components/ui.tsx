import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { Hearth } from "@/constants/hearth";

export function Screen({ children, edges = ["top"] }: { children: React.ReactNode; edges?: Edge[] }) {
  return <SafeAreaView style={s.screen} edges={edges}>{children}</SafeAreaView>;
}
export function H1({ children }: { children: React.ReactNode }) { return <Text style={s.h1}>{children}</Text>; }
export function H2({ children }: { children: React.ReactNode }) { return <Text style={s.h2}>{children}</Text>; }
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) { return <Text style={[s.body, style]}>{children}</Text>; }
export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) { return <Text style={[s.muted, style]}>{children}</Text>; }
export function Eyebrow({ children }: { children: React.ReactNode }) { return <Text style={s.eyebrow}>{children}</Text>; }

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Badge({ label, color = Hearth.ink500, bg = Hearth.surfaceSunken }: { label: string; color?: string; bg?: string }) {
  return <View style={[s.badge, { backgroundColor: bg }]}><Text style={[s.badgeText, { color }]}>{label}</Text></View>;
}

type BtnVariant = "primary" | "ember" | "success" | "danger" | "ghost";
export function Button({ title, onPress, variant = "primary", disabled, loading }: {
  title: string; onPress: () => void; variant?: BtnVariant; disabled?: boolean; loading?: boolean;
}) {
  const bg = variant === "ember" ? Hearth.ember400 : variant === "success" ? Hearth.sage600
    : variant === "danger" ? Hearth.coral600 : variant === "ghost" ? "transparent" : Hearth.ink800;
  const fg = variant === "ember" ? Hearth.ink900 : variant === "ghost" ? Hearth.ink600 : Hearth.white;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, variant === "ghost" && s.btnGhost]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Center({ children }: { children: React.ReactNode }) {
  return <View style={s.center}>{children}</View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Hearth.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: Hearth.paper },
  h1: { fontSize: 30, fontWeight: "700", color: Hearth.ink900, letterSpacing: -0.5 },
  h2: { fontSize: 13, fontWeight: "700", color: Hearth.ink500, textTransform: "uppercase", letterSpacing: 1 },
  eyebrow: { fontSize: 12, fontWeight: "600", color: Hearth.ink400, textTransform: "uppercase", letterSpacing: 1.5 },
  body: { fontSize: 15, color: Hearth.ink800, lineHeight: 22 },
  muted: { fontSize: 13, color: Hearth.ink500, lineHeight: 19 },
  card: { backgroundColor: Hearth.surface, borderRadius: 20, borderWidth: 1, borderColor: Hearth.border, padding: 16,
    shadowColor: "#26211a", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "600" },
  btn: { borderRadius: 16, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", minHeight: 44 },
  btnGhost: { borderWidth: 1, borderColor: Hearth.border },
  btnText: { fontSize: 15, fontWeight: "700" },
});
