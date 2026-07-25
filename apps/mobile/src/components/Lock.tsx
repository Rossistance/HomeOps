// Profile picker — the warm front door. Mirrors the web lock screen: profiles
// come from the server registry (/api/profiles), the same roster the session
// role is resolved from, so what you pick here is exactly what the server will
// grant. No typed-name actorId guessing, no client-chosen roles.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, type LayoutChangeEvent, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { api, API_URL, type ProfileRec } from "@/lib/api";
import { fade, memberAccent } from "@/lib/member-colors";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";
import {
  T, Card, PressableCard, Button, SkeletonCards, EmptyState, ErrorState, Notice, Rise, Sym,
} from "@/components/ui";

export function Lock() {
  const { colors, spacing, radii, fonts } = useTheme();
  const { setSession } = useSession();
  const scrollRef = useRef<ScrollView>(null);
  // A stable accent per member: their chosen colour, else a deterministic one from the
  // name so two people never look identical (mirrors lib/member-colors memberColor()).
  const FALLBACKS = ["sage", "coral", "amber", "sky", "lavender", "ink"];
  const accentOf = (p: ProfileRec): string =>
    memberAccent(colors, p.color)
    ?? memberAccent(colors, FALLBACKS[[...p.displayName].reduce((a, c) => a + c.charCodeAt(0), 0) % FALLBACKS.length])
    ?? colors.ember;
  const [profiles, setProfiles] = useState<ProfileRec[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProfileRec | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // C1.4 email identity: sign in / create-or-join a household of your own.
  const [emailMode, setEmailMode] = useState<null | "signin" | "create">(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [invitePreview, setInvitePreview] = useState<{ householdName: string | null; role: string } | null>(null);

  useEffect(() => {
    const t = inviteToken.trim();
    if (!t) { setInvitePreview(null); return; }
    void api.invitePreview(t).then((inv) => setInvitePreview(inv ? { householdName: inv.householdName, role: inv.role } : null));
  }, [inviteToken]);

  const submitEmail = async () => {
    setBusy(true); setErr(null);
    const r = emailMode === "signin"
      ? await api.loginEmail(email.trim(), password)
      : await api.signup({
          email: email.trim(), password, ownerName: ownerName.trim(),
          ...(inviteToken.trim() ? { inviteToken: inviteToken.trim() } : { householdName: newHouseholdName.trim() || undefined }),
        });
    setBusy(false);
    if (r.error) {
      setErr(r.error === "invalid_credentials" ? "Wrong email or password."
        : r.error === "email_taken" ? "That email already has an account — sign in instead."
        : r.error === "invalid_invite" ? "That invite code is invalid, used, or expired."
        : r.error === "weak_password" ? "Use a password of at least 8 characters."
        : r.error === "network" ? `Can't reach the server at ${api.url}.`
        : r.message ?? String(r.error));
      return;
    }
    if (r.session) setSession(r.session);
  };

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

  /* B1/B3 — the Lock screen showed identical flat letter tiles for everyone: "the
   * individual profiles do not reuse the profile images for the actual profiles inside the
   * app — I actually would like them to", and "these are not colored properly to match
   * what's inside of the application and they need to be."
   *
   * Photo → emoji → initials, and ALWAYS tinted with the member's own accent so a family
   * can pick their row out at a glance. The photo comes from the pre-auth avatar endpoint,
   * which is gated by the same privacy setting as this roster. */
  const ProfileAvatar = ({ p, accent }: { p: ProfileRec; accent: string }) => {
    const [failed, setFailed] = useState(false);
    const pid = p.photoFileId ?? null;
    const emoji = pid?.startsWith("emoji:") ? pid.slice("emoji:".length) : null;
    const showPhoto = !!pid && !emoji && !failed;
    return (
      <View style={{ width: 44, height: 44, borderRadius: 14, borderCurve: "continuous", backgroundColor: fade(accent, 0.16), alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1.5, borderColor: fade(accent, 0.5) }}>
        {showPhoto ? (
          <Image
            source={{ uri: `${API_URL}/api/profiles/${encodeURIComponent(p.actorId)}/avatar` }}
            style={{ width: "100%", height: "100%" }}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : emoji ? (
          <T kind="h3">{emoji}</T>
        ) : (
          <T kind="h3" color={accent}>{initials(p.displayName)}</T>
        )}
      </View>
    );
  };

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
            ref={scrollRef}
            automaticallyAdjustKeyboardInsets
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
                    style={[{ marginBottom: spacing.md }, active && { borderColor: accentOf(p) }]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                      <ProfileAvatar p={p} accent={accentOf(p)} />
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
                {/* C1 — "the box for the actual pin entry is now sitting right above the
                    keyboard, but it didn't refocus to where I can easily hit log in; I have
                    to click out somewhere to do it… what's better is that the sign in button
                    is still visible right above the keyboard and I do not have to scroll up."
                    onLayout reports where this card landed and we scroll it fully into view,
                    so Sign in arrives with the field instead of under the keyboard. */}
                <Card
                  style={{ marginTop: spacing.sm }}
                  onLayout={(e: LayoutChangeEvent) => {
                    const y = e.nativeEvent.layout.y;
                    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true }));
                  }}
                >
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

            {/* ── Email identity: your own household, separate from this one ── */}
            {!emailMode ? (
              <View style={{ marginTop: spacing.xl, alignItems: "center", gap: spacing.sm }}>
                <T kind="sub" center>Not part of this household?</T>
                <View style={{ flexDirection: "row", gap: spacing.lg }}>
                  <PressableCard onPress={() => { setEmailMode("signin"); setErr(null); }} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                    <T kind="subMedium" color={colors.ember}>Sign in with email</T>
                  </PressableCard>
                  <PressableCard onPress={() => { setEmailMode("create"); setErr(null); }} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                    <T kind="subMedium" color={colors.ember}>Create or join</T>
                  </PressableCard>
                </View>
              </View>
            ) : (
              <Rise index={(profiles?.length ?? 0) + 2}>
                <Card style={{ marginTop: spacing.xl }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <T kind="eyebrow">{emailMode === "signin" ? "Sign in with email" : inviteToken.trim() ? "Join a household" : "Create your household"}</T>
                    <PressableCard onPress={() => setEmailMode(emailMode === "signin" ? "create" : "signin")} style={{ paddingVertical: 4, paddingHorizontal: 8, borderWidth: 0, backgroundColor: "transparent" }}>
                      <T kind="caption" color={colors.textMuted}>{emailMode === "signin" ? "New here?" : "Have an account?"}</T>
                    </PressableCard>
                  </View>
                  {emailMode === "create" ? (
                    <>
                      <TextInput value={ownerName} onChangeText={setOwnerName} placeholder="Your name" placeholderTextColor={colors.textFaint} autoCapitalize="words" style={{ marginTop: spacing.md, backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous", paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 16, color: colors.text, fontFamily: fonts.regular }} />
                      <TextInput value={inviteToken} onChangeText={setInviteToken} placeholder="Invite code (optional)" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous", paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 16, color: colors.text, fontFamily: fonts.regular }} />
                      {invitePreview ? (
                        <T kind="caption" color={colors.sage} style={{ marginTop: spacing.xs }}>Joining {invitePreview.householdName ?? "a household"} as {invitePreview.role}.</T>
                      ) : inviteToken.trim() ? (
                        <T kind="caption" color={colors.amber} style={{ marginTop: spacing.xs }}>That code doesn&apos;t look valid — check it or clear it to start fresh.</T>
                      ) : (
                        <TextInput value={newHouseholdName} onChangeText={setNewHouseholdName} placeholder="Household name (optional)" placeholderTextColor={colors.textFaint} autoCapitalize="words" style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous", paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 16, color: colors.text, fontFamily: fonts.regular }} />
                      )}
                    </>
                  ) : null}
                  <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" inputMode="email" style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous", paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 16, color: colors.text, fontFamily: fonts.regular }} />
                  <TextInput value={password} onChangeText={setPassword} placeholder="Password (8+ characters)" placeholderTextColor={colors.textFaint} secureTextEntry autoCapitalize="none" style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous", paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 16, color: colors.text, fontFamily: fonts.regular }} />
                  <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                    <Button
                      title={emailMode === "signin" ? "Sign in" : inviteToken.trim() ? "Join household" : "Create household"}
                      variant="ember" full loading={busy}
                      disabled={busy || !email.trim() || password.length < 8 || (emailMode === "create" && !ownerName.trim())}
                      onPress={() => void submitEmail()}
                    />
                    <Button title="Cancel" variant="ghost" full onPress={() => { setEmailMode(null); setErr(null); }} />
                  </View>
                  {emailMode === "create" && !inviteToken.trim() ? (
                    <T kind="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
                      Your household gets its own private space — completely separate from every other family&apos;s.
                    </T>
                  ) : null}
                </Card>
              </Rise>
            )}

            <T kind="caption" center selectable color={colors.textFaint} style={{ marginTop: spacing.xl }}>
              API · {api.url}
            </T>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
