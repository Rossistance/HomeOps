// First-run onboarding (5 steps, per handoff). Runs after sign-in, once.
//
// NOTHING HERE CREATES A HELPER. There used to be a "Pick your starting agents" step, and it
// was untrue in two directions at once: the app seeds no helpers for a new family, so on a
// real first run the list was empty and the step silently disappeared — and anywhere it did
// appear, a toggle activated something whose instructions the family had never read. Both
// are the same mistake: acting as if a decision had been made on their behalf.
//
// What replaces it shows a few real ready-made helpers, says plainly that none of them exist
// yet, and points at the Helpers tab. Members and the profile step still write through the
// same APIs the Settings screens use.
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, tapHaptic } from "@/theme";
import { useOnboarding } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import { ColorPicker } from "@/components/ui/color-picker";
import { api, type HelperTemplate, type MemberRec } from "@/lib/api";
import { HuddleMark, Wordmark, SPLASH_BG } from "@/components/brand";
import { memberAccent } from "@/lib/member-colors";
import { MemberAvatar } from "@/app/(home)/profile";
import { T, Sym, SymTile, Card, PressableScale } from "@/components/ui";

const ADMIN_ROLES = new Set(["Owner", "Adult Admin"]);

/* D7 [03:59] — "There should be a walkthrough for a new household: set your profile, add a
 * picture, pick an icon, pick a color, basic info — plus the starting agents, and some
 * preferences, facts, knowledge."
 *
 * A real profile (photo or emoji, and the colour every other screen then identifies you by),
 * and a first pass at what the household wants the assistant to know. Both write through the
 * same APIs the Settings screens use, so nothing here is a special onboarding-only shortcut
 * that drifts later. "The starting agents" is the one part answered differently — see the
 * note at the top of this file. */
// ACCENTS lives in lib/member-colors now — one list for the whole app.
const EMOJIS = ["🦊", "🐻", "🦉", "🐙", "🌻", "🍀", "⭐️", "🌈", "🐝", "🦋", "🍕", "⚽️"] as const;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;  // matches the server cap

// Prompts, not pre-written facts: the content has to come from the family, or the assistant
// starts out "knowing" things nobody told it.
const KNOWLEDGE_PROMPTS = [
  { key: "routine", title: "Our week", placeholder: "School nights, practice days, who does drop-off…" },
  { key: "food", title: "Food and allergies", placeholder: "Anything the kitchen has to work around" },
  { key: "prefs", title: "How we like to be helped", placeholder: "Ask before sending anything, keep it short, text not email…" },
] as const;

const TRUST_ROWS = [
  { icon: "wand.and.stars", title: "Helpers watch and draft", desc: "Briefings, forms and bills — prepared quietly in the background" },
  { icon: "checkmark.shield", title: "You approve what leaves home", desc: "Emails, texts, payments — nothing goes out without your OK" },
  { icon: "clock", title: "Everything is logged", desc: "Every action lands in Activity, in plain language" },
] as const;

export function Onboarding() {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const { setOnboarded } = useOnboarding();
  const { session } = useSession();
  const firstName = (session?.actorName ?? "there").split(" ")[0];
  const isAdmin = ADMIN_ROLES.has(session?.role ?? "");

  const [step, setStep] = useState(0);
  const [members, setMembers] = useState<MemberRec[]>([]);
  // Read-only: a taste of what a helper is. Nothing on this screen saves one.
  const [templates, setTemplates] = useState<HelperTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [householdName, setHouseholdName] = useState("");
  const isOwner = session?.role === "Owner";
  // D7 — profile step
  const [myName, setMyName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [photoFileId, setPhotoFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  // D7 — knowledge step
  const [facts, setFacts] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const [m, sections, hh] = await Promise.all([
        api.members(),
        api.helperTemplates().catch(() => []),
        api.household(),
      ]);
      setMembers(m);
      setTemplates(sections.flatMap((sec) => sec.templates).slice(0, 3));
      setHouseholdName(hh?.name ?? "");
      const me = m.find((x) => x.isCurrentUser);
      if (me) { setMyName(me.displayName); setColor(me.color ?? null); setPhotoFileId(me.photoFileId ?? null); }
    })();
  }, []);

  // D7 — the walkthrough he described, in his order: who you are, then the household, then
  // what it should know, then where the helpers live. Non-admins skip the two household-wide
  // steps they can't act on rather than being shown dead controls.
  //
  // The helpers step no longer depends on there BEING any: it exists precisely to say there
  // aren't yet, which is the fact the old conditional step hid by quietly disappearing.
  const steps = useMemo(() => {
    const out = ["welcome", "trust", "profile"];
    out.push("household");
    if (isAdmin) out.push("knowledge", "helpers");
    out.push("ready");
    return out;
  }, [isAdmin]);
  const kind = steps[Math.min(step, steps.length - 1)];

  async function finish() {
    if (saving) return;
    setSaving(true);
    // D7 — the profile is saved through the SAME endpoint the Profile screen uses, so what
    // onboarding sets and what Settings edits are one record with one shape.
    if (session?.actorId && (myName.trim() || color || photoFileId)) {
      await api.patchMember(session.actorId, {
        ...(myName.trim() ? { displayName: myName.trim() } : {}),
        color, photoFileId,
      }).catch(() => null);
    }
    // D7 — whatever the family typed becomes real household knowledge, one item per prompt.
    // Blank prompts write nothing: an empty "Food and allergies" note is worse than none,
    // because the assistant would read it as "nothing to work around".
    for (const prompt of KNOWLEDGE_PROMPTS) {
      const content = (facts[prompt.key] ?? "").trim();
      if (!content) continue;
      await api.createKnowledge({ title: prompt.title, type: "fact", content, visibility: "household" }).catch(() => null);
    }
    // Owner-typed household name persists server-side (appears on briefings/invites).
    if (isOwner && householdName.trim()) {
      await api.renameHousehold(householdName.trim()).catch(() => null);
    }
    // No helper is created, activated or paused by finishing setup. A household arrives with
    // exactly what it asked for, which is nothing yet.
    tapHaptic("success");
    setOnboarded(true);
  }

  function next() {
    tapHaptic("light");
    if (step >= steps.length - 1) { void finish(); return; }
    setStep(step + 1);
  }

  const filledFacts = KNOWLEDGE_PROMPTS.filter((k) => (facts[k.key] ?? "").trim()).length;
  const ctaLabel =
    kind === "welcome" ? "Get started"
    : kind === "ready" ? "Enter FamiliOS"
    : kind === "helpers" ? "Got it"
    // Naming what happens next, so skipping is a choice rather than an accident.
    : kind === "knowledge" ? (filledFacts === 0 ? "Skip for now" : `Save ${filledFacts} note${filledFacts === 1 ? "" : "s"}`)
    : "Continue";

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* header: back chevron + progress dots (active dot stretches) */}
      <View style={st.header}>
        <Pressable hitSlop={12} onPress={() => step > 0 && setStep(step - 1)} style={{ width: 40 }}>
          {step > 0 && <Sym name="chevron.left" size={20} color={colors.textSecondary} />}
        </Pressable>
        <View style={st.dots}>
          {steps.map((s, i) => (
            <View
              key={s}
              style={{
                height: 7, borderRadius: 4,
                width: i === step ? 20 : 7,
                backgroundColor: i === step ? colors.ember : colors.textFaint,
              }}
            />
          ))}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, flexGrow: 1 }}>
        {kind === "welcome" && (
          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.lg }}>
            <LinearGradient colors={SPLASH_BG} start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }} style={st.heroCard}>
              <View style={st.heroGlow} />
              <HuddleMark size={64} />
              <Wordmark size={30} light />
              <T kind="sub" color="rgba(245,241,233,0.65)">Your family's operating system.</T>
            </LinearGradient>
            <T kind="h1" style={{ fontSize: 26, lineHeight: 32 }}>The mental load, off your mind</T>
            <T kind="body">Careful helpers for the calendar, school papers, bills and care — written by your family, approved by you.</T>
          </Animated.View>
        )}

        {kind === "trust" && (
          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.lg }}>
            <T kind="h1" style={{ fontSize: 26, lineHeight: 32 }}>Careful help, on your terms</T>
            <T kind="body">FamiliOS never acts alone. Here's the deal:</T>
            <Card style={{ gap: spacing.lg }}>
              {TRUST_ROWS.map((r) => (
                <View key={r.title} style={st.trustRow}>
                  <SymTile name={r.icon} color={colors.ember} bg={colors.emberBg} size={40} iconSize={19} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T kind="rowTitle">{r.title}</T>
                    <T kind="detail">{r.desc}</T>
                  </View>
                </View>
              ))}
            </Card>
          </Animated.View>
        )}

        {/* D7 — "set your profile, add a picture, pick an icon, pick a color". The emoji IS
            the icon: it's what the picker offers and what every avatar in the app renders. */}
        {kind === "profile" && (
          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.lg }}>
            <T kind="h1" style={{ fontSize: 26, lineHeight: 32 }}>Make it yours</T>
            <T kind="body">A face and a colour — it&apos;s how your family picks you out on every screen.</T>

            <View style={{ alignItems: "center", gap: spacing.md }}>
              <MemberAvatar
                member={{
                  actorId: session?.actorId ?? "", displayName: myName || firstName, role: session?.role ?? "",
                  relationship: null, spaceIds: [], isCurrentUser: true, color, photoFileId,
                }}
                size={92}
              />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <PressableScale
                  haptic="select"
                  onPress={() => void (async () => {
                    setPhotoNote(null);
                    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!perm.granted) { setPhotoNote("Photo access was denied — an emoji works just as well."); return; }
                    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7, allowsEditing: true, aspect: [1, 1] });
                    if (res.canceled || !res.assets?.[0]?.base64) return;
                    const a = res.assets[0];
                    if (a.base64!.length * 0.75 > MAX_PHOTO_BYTES) { setPhotoNote("That photo is over the 25 MB cap."); return; }
                    setUploading(true);
                    const up = await api.uploadFile({ name: a.fileName ?? `avatar-${Date.now()}.jpg`, contentBase64: a.base64!, mime: a.mimeType ?? "image/jpeg", visibility: "private", kind: "avatar" });
                    setUploading(false);
                    if (!up.file) { setPhotoNote("Couldn't upload that one — try another, or pick an emoji."); return; }
                    setPhotoFileId(up.file.id);
                  })()}
                  accessibilityRole="button" accessibilityLabel="Add a photo"
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border }}
                >
                  <Sym name="photo" size={13} color={colors.ember} />
                  <T kind="subMedium" color={colors.ember}>{uploading ? "Uploading…" : "Add a photo"}</T>
                </PressableScale>
                {photoFileId ? (
                  <PressableScale
                    haptic="select" onPress={() => setPhotoFileId(null)}
                    accessibilityRole="button" accessibilityLabel="Remove"
                    style={{ paddingHorizontal: 14, paddingVertical: 9 }}
                  >
                    <T kind="subMedium" color={colors.textMuted}>Remove</T>
                  </PressableScale>
                ) : null}
              </View>
              {photoNote ? <T kind="caption" color={colors.amber}>{photoNote}</T> : null}
            </View>

            <View style={{ gap: 6 }}>
              <T kind="eyebrow">Your name</T>
              <View style={{ backgroundColor: colors.surfaceSunken, borderRadius: 16, borderCurve: "continuous" }}>
                <TextInput
                  value={myName}
                  onChangeText={setMyName}
                  placeholder="What the family calls you"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="words"
                  accessibilityLabel="Your name"
                  style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.text }}
                />
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <T kind="eyebrow">Or pick an icon</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {EMOJIS.map((e) => {
                  const selected = photoFileId === `emoji:${e}`;
                  return (
                    <PressableScale
                      key={e} haptic="select"
                      onPress={() => setPhotoFileId(selected ? null : `emoji:${e}`)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Icon ${e}`}
                      style={{
                        width: 46, height: 46, borderRadius: 14, borderCurve: "continuous",
                        alignItems: "center", justifyContent: "center",
                        backgroundColor: selected ? colors.emberBg : colors.surfaceSunken,
                        borderWidth: selected ? 2 : 0, borderColor: colors.ember,
                      }}
                    >
                      <T style={{ fontSize: 22 }}>{e}</T>
                    </PressableScale>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <T kind="eyebrow">Your colour</T>
              {/* Same picker as everywhere else; compact because the household is empty —
                  there is nobody to collide with on day one. */}
              <ColorPicker value={color} onChange={setColor} others={[]} compact />
            </View>
          </Animated.View>
        )}

        {/* D7 — "plus some preferences, facts, knowledge." Prompts only: the content has to
            come from the family, or the assistant starts out "knowing" things nobody said. */}
        {kind === "knowledge" && (
          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.lg }}>
            <T kind="h1" style={{ fontSize: 26, lineHeight: 32 }}>What should it know?</T>
            <T kind="body">
              A few lines now save a lot of explaining later. Skip anything you&apos;d rather add as it
              comes up — you can edit all of this in Files &amp; Knowledge.
            </T>
            {KNOWLEDGE_PROMPTS.map((k) => (
              <View key={k.key} style={{ gap: 6 }}>
                <T kind="eyebrow">{k.title}</T>
                <View style={{ backgroundColor: colors.surfaceSunken, borderRadius: 16, borderCurve: "continuous" }}>
                  <TextInput
                    value={facts[k.key] ?? ""}
                    onChangeText={(t) => setFacts((f) => ({ ...f, [k.key]: t }))}
                    placeholder={k.placeholder}
                    placeholderTextColor={colors.textFaint}
                    multiline
                    accessibilityLabel={k.title}
                    style={{ paddingHorizontal: 16, paddingVertical: 14, minHeight: 76, fontSize: 15, color: colors.text, textAlignVertical: "top" }}
                  />
                </View>
              </View>
            ))}
          </Animated.View>
        )}

        {kind === "household" && (
          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.lg }}>
            <T kind="h1" style={{ fontSize: 26, lineHeight: 32 }}>{isOwner ? "Name your household" : "Your household"}</T>
            <T kind="body">
              {isOwner
                ? "It appears on briefings, invites and updates."
                : "Everyone here shares the family calendar. Spaces like Medical or Bills stay with the adults you choose."}
            </T>
            {isOwner && (
              <View style={{ backgroundColor: colors.surfaceSunken, borderRadius: 16, borderCurve: "continuous" }}>
                <TextInput
                  value={householdName}
                  onChangeText={setHouseholdName}
                  placeholder="e.g. The Harper Family"
                  placeholderTextColor={colors.textFaint}
                  style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 19, color: colors.text, fontFamily: "Newsreader_600SemiBold" }}
                />
              </View>
            )}
            <Card style={{ gap: spacing.md }}>
              {(members.length ? members : null)?.map((m) => (
                <View key={m.actorId} style={st.trustRow}>
                  <View style={[st.avatar, { backgroundColor: colors.emberBg }]}>
                    <T kind="caption" color={colors.ember}>{m.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T kind="rowTitle">{m.displayName}{m.isCurrentUser ? " — that's you" : ""}</T>
                    <T kind="detail">{m.relationship ?? m.role}</T>
                  </View>
                </View>
              )) ?? <T kind="sub">Loading your household…</T>}
            </Card>
            <T kind="detail" center>Invite the rest of the family after setup — Settings → Household.</T>
          </Animated.View>
        )}

        {kind === "helpers" && (
          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.lg }}>
            <T kind="h1" style={{ fontSize: 26, lineHeight: 32 }}>Helpers, when you want one</T>
            {/* The honest sentence. Nothing has been set up, and nothing on this screen will
                set anything up — the old version implied a team was already waiting. */}
            <T kind="body">
              You don&apos;t have any yet, and we haven&apos;t made any for you. A helper is one job
              you&apos;d rather not remember — you tell it what to do in your own words, when to do
              it, and how much it may do without asking.
            </T>
            {templates.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <T kind="eyebrow">Ready-made ones you can start from</T>
                {templates.map((t) => (
                  // Not tappable. This is a preview, and a tap that did nothing would be a
                  // worse promise than no tap at all.
                  <View key={t.id} style={[st.agentRow, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}>
                    <SymTile name={t.icon || "sparkle"} color={colors.ember} bg={colors.emberBg} size={40} iconSize={19} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle">{t.name}</T>
                      <T kind="detail" numberOfLines={2}>{t.purpose}</T>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <SymTile name="wand.and.stars" color={colors.ember} bg={colors.emberBg} size={38} iconSize={18} />
              <View style={{ flex: 1, gap: 2 }}>
                <T kind="rowTitle">Find them on the Helpers tab</T>
                <T kind="detail">New helper → pick one of these or start from scratch. You read and edit what it does before it&apos;s saved.</T>
              </View>
            </Card>
          </Animated.View>
        )}

        {kind === "ready" && (
          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.lg, alignItems: "center" }}>
            <View style={[st.readyCheck, { backgroundColor: colors.sageBg }]}>
              <Sym name="checkmark" size={34} color={colors.sage} />
            </View>
            <T kind="h1" style={{ fontSize: 26, lineHeight: 32 }} center>You're set, {firstName}</T>
            <Card style={{ alignSelf: "stretch", gap: spacing.md }}>
              <View style={st.trustRow}>
                <SymTile name="house" color={colors.ember} bg={colors.emberBg} size={38} iconSize={18} />
                <View style={{ flex: 1 }}>
                  <T kind="rowTitle">{members.length} member{members.length === 1 ? "" : "s"}</T>
                  <T kind="detail">Your household</T>
                </View>
              </View>
              {isAdmin && (
                <View style={st.trustRow}>
                  <SymTile name="wand.and.stars" color={colors.sky} bg={colors.skyBg} size={38} iconSize={18} />
                  <View style={{ flex: 1 }}>
                    {/* Says what is true — no helpers — rather than counting ones nobody made. */}
                    <T kind="rowTitle">No helpers yet</T>
                    <T kind="detail">Make your first one on the Helpers tab</T>
                  </View>
                </View>
              )}
              <View style={st.trustRow}>
                <SymTile name="checkmark.shield" color={colors.sage} bg={colors.sageBg} size={38} iconSize={18} />
                <View style={{ flex: 1 }}>
                  <T kind="rowTitle">Approvals on</T>
                  <T kind="detail">Nothing leaves home without you</T>
                </View>
              </View>
            </Card>
            <T kind="detail" center>Connect Gmail and Google Calendar in Settings when you're ready.</T>
          </Animated.View>
        )}
      </ScrollView>

      <View style={{ padding: spacing.xl, paddingBottom: Math.max(insets.bottom, spacing.lg), gap: spacing.md }}>
        <PressableScale
          onPress={next}
          disabled={saving}
          style={{
            height: 52, borderRadius: 15, borderCurve: "continuous",
            alignItems: "center", justifyContent: "center",
            backgroundColor: colors.ember, opacity: saving ? 0.6 : 1,
            boxShadow: "0 10px 24px -12px rgba(206,93,29,0.55)",
          }}
        >
          <T kind="bodyMedium" color={colors.onEmber} style={{ fontWeight: "600" }}>{ctaLabel}</T>
        </PressableScale>
        {kind === "welcome" && (
          <T kind="detail" center>Private by design — your family's data stays in the household.</T>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  heroCard: { borderRadius: 22, borderCurve: "continuous", padding: 28, alignItems: "center", gap: 12, overflow: "hidden" },
  heroGlow: {
    position: "absolute", right: -60, bottom: -60, width: 180, height: 180, borderRadius: 180,
    backgroundColor: "rgba(224,102,44,0.25)", boxShadow: "0 0 60px 40px rgba(224,102,44,0.25)",
  },
  trustRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  agentRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderCurve: "continuous", padding: 13 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  readyCheck: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginTop: 12 },
});
