// Profile picker — the warm front door. Mirrors the web lock screen: profiles
// come from the server registry (/api/profiles), the same roster the session
// role is resolved from, so what you pick here is exactly what the server will
// grant. No typed-name actorId guessing, no client-chosen roles.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { api, type ProfileRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";
import {
  T, Card, PressableCard, Button, SkeletonCards, EmptyState, ErrorState, Notice, Rise, Sym,
} from "@/components/ui";

export function Lock() {
  const { colors, spacing, radii, fonts } = useTheme();
  const { setSession } = useSession();
  const [profiles, setProfiles] = useState<ProfileRec[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProfileRec | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    const r = await api.profiles();
    if (!r) { setProfiles(null); setLoadErr(`Can't reach the server at ${api.url}. Make sure "npm run dev" is running on your PC and you're on the same Wi-Fi.`); return; }
    setProfiles(r.profiles);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const signIn = async (p: ProfileRec, withPin?: string) => {
    setBusy(true); setErr(null);
    const r = await api.login({ actorId: p.actorId, actorName: p.displayName, role: p.role, pin: withPin || undefined });
    setBusy(false);
    if (r.error === "pin_required") { setSelected(p); setErr("This profile needs the household PIN."); return; }
    if (r.error) {
      setErr(r.error === "network"
        ? `Can't reach the server at ${api.url}.`
        : r.error === "member_archived" ? "This profile was removed from the household."
        : r.error === "unknown_actor" ? "This profile isn't registered with the backend anymore. Pull to refresh the list."
        : String(r.error));
      return;
    }
    if (r.session) setSession(r.session);
  };

  const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Hearth glow rising from the bottom edge — same ember in light and dark
          (emberBg is translucent, so it warms the paper without shouting). */}
      <LinearGradient
        colors={["transparent", colors.emberBg] as const}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 340 }}
        pointerEvents="none"
      />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.xl, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.textFaint} />}
          >
            <Rise index={0}>
              <View style={{ alignItems: "center", marginBottom: spacing.xxl }}>
                <View style={{ width: 64, height: 64, borderRadius: 20, borderCurve: "continuous", backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg }}>
                  <Sym name="flame.fill" size={30} color={colors.ember} />
                </View>
                <T kind="h1" center>Welcome home</T>
                <T kind="sub" center style={{ marginTop: spacing.sm, maxWidth: 300 }}>
                  Pick your profile. Your role comes from the household&apos;s server — it decides what you can see and approve.
                </T>
              </View>
            </Rise>

            {profiles === null && !loadErr ? <SkeletonCards count={3} lines={1} /> : null}

            {loadErr ? <ErrorState message={loadErr} onRetry={() => void load()} /> : null}

            {profiles && profiles.length === 0 ? (
              <EmptyState
                icon="person.2"
                title="No profiles yet"
                hint="Create your household on the web app first — it registers the owner with the backend."
              />
            ) : null}

            {profiles?.map((p, i) => {
              const active = selected?.actorId === p.actorId;
              return (
                <Rise key={p.actorId} index={i + 1}>
                  <PressableCard
                    onPress={() => { setSelected(p); setErr(null); setPin(""); if (!p.pinRequired) void signIn(p); }}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Sign in as ${p.displayName}, ${p.role}${p.pinRequired ? ", PIN required" : ""}`}
                    style={[{ marginBottom: spacing.md }, active && { borderColor: colors.ember }]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                      <View style={{ width: 44, height: 44, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}>
                        <T kind="h3" color={colors.ember}>{initials(p.displayName)}</T>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="bodyMedium" color={colors.text}>{p.displayName}</T>
                        <T kind="sub">{p.role}{p.relationship ? ` · ${p.relationship}` : ""}{p.pinRequired ? " · PIN" : ""}</T>
                      </View>
                      {busy && active ? (
                        <ActivityIndicator color={colors.ember} />
                      ) : (
                        <Sym name={p.pinRequired ? "lock.fill" : "chevron.right"} size={p.pinRequired ? 14 : 13} color={colors.textFaint} />
                      )}
                    </View>
                  </PressableCard>
                </Rise>
              );
            })}

            {selected?.pinRequired ? (
              <Rise index={(profiles?.length ?? 0) + 1}>
                <Card style={{ marginTop: spacing.sm }}>
                  <T kind="eyebrow">Household PIN · {selected.displayName}</T>
                  <TextInput
                    value={pin}
                    onChangeText={setPin}
                    placeholder="••••"
                    placeholderTextColor={colors.textFaint}
                    secureTextEntry
                    keyboardType="number-pad"
                    autoFocus
                    accessibilityLabel="Household PIN"
                    style={{
                      marginTop: spacing.sm,
                      backgroundColor: colors.surfaceSunken,
                      borderRadius: radii.md,
                      borderCurve: "continuous",
                      paddingHorizontal: spacing.lg,
                      paddingVertical: 12,
                      fontSize: 18,
                      letterSpacing: 6,
                      color: colors.text,
                      fontFamily: fonts.semibold,
                    }}
                  />
                  <View style={{ marginTop: spacing.md }}>
                    <Button title="Sign in" variant="ember" full loading={busy} disabled={busy || !pin} onPress={() => void signIn(selected, pin)} />
                  </View>
                </Card>
              </Rise>
            ) : null}

            {err ? <View style={{ marginTop: spacing.md }}><Notice text={err} ok={false} /></View> : null}

            <T kind="caption" center selectable color={colors.textFaint} style={{ marginTop: spacing.xl }}>
              API · {api.url}
            </T>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
