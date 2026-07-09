// First-run onboarding (5 steps, per handoff). Runs after sign-in, once.
// Steps 3 and 4 are wired to the real household: members come from the API and
// the starter-agent picker activates/pauses the household's real agents.
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, tapHaptic } from "@/theme";
import { useOnboarding } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import { api, type AgentRec, type MemberRec } from "@/lib/api";
import { HuddleMark, Wordmark, SPLASH_BG } from "@/components/brand";
import { T, Sym, SymTile, Card, PressableScale } from "@/components/ui";

const ADMIN_ROLES = new Set(["Owner", "Adult Admin"]);

const TRUST_ROWS = [
  { icon: "cpu", title: "Agents watch and draft", desc: "Briefings, forms and bills — prepared quietly in the background" },
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
  const [agents, setAgents] = useState<AgentRec[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [householdName, setHouseholdName] = useState("");
  const isOwner = session?.role === "Owner";

  useEffect(() => {
    void (async () => {
      const [m, a, hh] = await Promise.all([api.members(), api.agents(), api.household()]);
      setMembers(m);
      setAgents(a);
      setHouseholdName(hh?.name ?? "");
      const initial: Record<string, boolean> = {};
      for (const ag of a) initial[ag.id] = ag.status === "Active";
      setPicked(initial);
    })();
  }, []);

  // Non-admins can't manage agents; they skip the picker.
  const steps = useMemo(() => (isAdmin && agents.length > 0
    ? ["welcome", "trust", "household", "agents", "ready"]
    : ["welcome", "trust", "household", "ready"]) as string[], [isAdmin, agents.length]);
  const kind = steps[Math.min(step, steps.length - 1)];
  const pickedCount = Object.values(picked).filter(Boolean).length;

  async function finish() {
    if (saving) return;
    setSaving(true);
    // Owner-typed household name persists server-side (appears on briefings/invites).
    if (isOwner && householdName.trim()) {
      await api.renameHousehold(householdName.trim()).catch(() => null);
    }
    // Handoff rule: unpicked starter agents launch as Paused. Only touch agents
    // whose status actually changes; failures are non-fatal (Agents tab can fix).
    if (isAdmin) {
      await Promise.all(agents.map((ag) => {
        const want = picked[ag.id] ? "Active" : "Paused";
        if (ag.status === want || (!picked[ag.id] && ag.status !== "Active")) return Promise.resolve(null);
        return api.patchAgent(ag.id, { status: want }).catch(() => null);
      }));
    }
    tapHaptic("success");
    setOnboarded(true);
  }

  function next() {
    tapHaptic("light");
    if (step >= steps.length - 1) { void finish(); return; }
    setStep(step + 1);
  }

  const ctaLabel =
    kind === "welcome" ? "Get started"
    : kind === "ready" ? "Enter FamiliOS"
    : kind === "agents" ? `Start with ${pickedCount} agent${pickedCount === 1 ? "" : "s"}`
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
            <T kind="body">A team of careful agents for the calendar, school papers, bills and care — run by your family, approved by you.</T>
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

        {kind === "agents" && (
          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.lg }}>
            <T kind="h1" style={{ fontSize: 26, lineHeight: 32 }}>Pick your starting agents</T>
            <T kind="body">These are your household's agents — turn on the ones you want running. Add or pause anytime.</T>
            <View style={{ gap: spacing.sm }}>
              {agents.map((ag) => {
                const on = !!picked[ag.id];
                return (
                  <PressableScale
                    key={ag.id}
                    onPress={() => { tapHaptic("select"); setPicked((p) => ({ ...p, [ag.id]: !p[ag.id] })); }}
                    style={[st.agentRow, {
                      backgroundColor: colors.surface,
                      borderColor: on ? colors.ember : colors.border,
                      borderWidth: on ? 1.5 : 1,
                    }]}
                  >
                    <SymTile name="cpu" color={on ? colors.ember : colors.textMuted} bg={on ? colors.emberBg : colors.surfaceSunken} size={40} iconSize={19} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle">{ag.name}</T>
                      {!!ag.purpose && <T kind="detail" numberOfLines={1}>{ag.purpose}</T>}
                    </View>
                    <View style={[st.radio, { borderColor: on ? colors.ember : colors.textFaint, backgroundColor: on ? colors.ember : "transparent" }]}>
                      {on && <Sym name="checkmark" size={13} color={colors.onEmber} />}
                    </View>
                  </PressableScale>
                );
              })}
            </View>
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
              {agents.length > 0 && (
                <View style={st.trustRow}>
                  <SymTile name="cpu" color={colors.sky} bg={colors.skyBg} size={38} iconSize={18} />
                  <View style={{ flex: 1 }}>
                    <T kind="rowTitle">{pickedCount} agent{pickedCount === 1 ? "" : "s"} ready</T>
                    <T kind="detail">Add more anytime in Agents</T>
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
