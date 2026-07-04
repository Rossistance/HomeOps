import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type ProfileRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button, Card, H1, Muted } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Profile picker — mirrors the web lock screen. Profiles come from the server
// registry (/api/profiles): the same roster the session role is resolved from,
// so what you pick here is exactly what the server will grant. No typed-name
// actorId guessing, no client-chosen roles.
export function Lock() {
  const { setSession } = useSession();
  const [profiles, setProfiles] = useState<ProfileRec[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProfileRec | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    const r = await api.profiles();
    if (!r) { setProfiles(null); setLoadErr(`Can't reach the server at ${api.url}. Make sure "npm run dev" is running on your PC and you're on the same Wi-Fi.`); return; }
    setProfiles(r.profiles);
  }, []);
  useEffect(() => { void load(); }, [load]);

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

  return (
    <SafeAreaView style={st.wrap}>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <View style={st.brand}><Text style={st.brandMark}>⌂</Text></View>
        <H1>Who's using HomeOps?</H1>
        <Muted style={{ marginTop: 6, textAlign: "center" }}>Pick your profile. Your role is set by the household's server — it controls what you can see and approve.</Muted>

        {profiles === null && !loadErr && (
          <View style={{ marginTop: 32 }}><ActivityIndicator color={Hearth.ember500} size="large" /></View>
        )}

        {loadErr && (
          <Card style={{ marginTop: 24, width: "100%" }}>
            <Text style={st.err}>{loadErr}</Text>
            <View style={{ marginTop: 12 }}><Button title="Try again" variant="ghost" onPress={() => void load()} /></View>
          </Card>
        )}

        {profiles && profiles.length === 0 && (
          <Card style={{ marginTop: 24, width: "100%" }}>
            <Muted>No profiles are registered yet. Create your household on the web app first — it registers the owner with the backend.</Muted>
          </Card>
        )}

        {profiles && profiles.map((p) => (
          <Pressable
            key={p.actorId}
            onPress={() => { setSelected(p); setErr(null); setPin(""); if (!p.pinRequired) void signIn(p); }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Sign in as ${p.displayName}, ${p.role}${p.pinRequired ? ", PIN required" : ""}`}
            style={({ pressed }) => [st.profile, pressed && { opacity: 0.85 }, selected?.actorId === p.actorId && st.profileOn]}>
            <View style={st.avatar}><Text style={st.avatarText}>{p.displayName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={st.profileName}>{p.displayName}</Text>
              <Muted style={{ fontSize: 12 }}>{p.role}{p.relationship ? ` · ${p.relationship}` : ""}{p.pinRequired ? " · PIN" : ""}</Muted>
            </View>
            {busy && selected?.actorId === p.actorId ? <ActivityIndicator color={Hearth.ember500} /> : null}
          </Pressable>
        ))}

        {selected?.pinRequired && (
          <Card style={{ marginTop: 12, width: "100%" }}>
            <Text style={st.label}>Household PIN for {selected.displayName}</Text>
            <TextInput value={pin} onChangeText={setPin} placeholder="••••" placeholderTextColor={Hearth.ink400} style={st.input} secureTextEntry keyboardType="number-pad" accessibilityLabel="Household PIN" />
            <View style={{ marginTop: 12 }}>
              <Button title="Sign in" variant="ember" loading={busy} disabled={busy || !pin} onPress={() => void signIn(selected, pin)} />
            </View>
          </Card>
        )}

        {err && <Text style={[st.err, { marginTop: 12 }]}>{err}</Text>}
        <Muted style={{ marginTop: 16, textAlign: "center" }}>API: {api.url}</Muted>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: Hearth.paper },
  content: { padding: 24, alignItems: "center", justifyContent: "center", flexGrow: 1 },
  brand: { width: 56, height: 56, borderRadius: 18, backgroundColor: Hearth.ink900, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  brandMark: { color: Hearth.ember400, fontSize: 30, lineHeight: 34 },
  label: { fontSize: 12, fontWeight: "700", color: Hearth.ink500, textTransform: "uppercase", letterSpacing: 0.6 },
  input: { marginTop: 6, borderWidth: 1, borderColor: Hearth.border, backgroundColor: Hearth.rim, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: Hearth.ink900 },
  profile: {
    flexDirection: "row", alignItems: "center", gap: 12, width: "100%",
    backgroundColor: Hearth.surface, borderWidth: 1, borderColor: Hearth.border, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 10,
  },
  profileOn: { borderColor: Hearth.ember400 },
  profileName: { fontSize: 16, fontWeight: "700", color: Hearth.ink900 },
  avatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: Hearth.ink800, alignItems: "center", justifyContent: "center" },
  avatarText: { color: Hearth.ember400, fontSize: 14, fontWeight: "700" },
  err: { color: Hearth.coral600, fontSize: 13 },
});
