// D5 — the operator's invite desk.
//
// From the 2026-07-25 walkthrough at [02:25]: "There should also be an owner-side interface
// where I can generate invite codes for any household — I am the inventor and owner of the
// application. New households do not get this."
//
// This screen exists only for the platform operator, and "operator" is deliberately not a
// household role: it's a deployment env listing the operator's own sign-in email
// (HOMEOPS_OPERATOR_EMAILS). A household Owner — even the one who owns this very household —
// gets a 404 from the routes behind this screen, because a capability that reaches across
// families must not live in a field a family controls.
import { useCallback, useState } from "react";
import { Alert, Share, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, type AdminHouseholdRec, type InviteRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import {
  T, Card, Chip, ChipRow, EmptyState, ExpandCard, HScreen, Notice, PressableScale,
  Rise, SectionHeader, SkeletonCards, Sym,
} from "@/components/ui";

// Owner is deliberately absent: the server refuses to grant it by invite, and offering it
// here would be a control that quietly does something else.
const ROLES = ["Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"];

export default function OperatorScreen() {
  const { colors, spacing, radii, type } = useTheme();
  const { session } = useSession();
  const [households, setHouseholds] = useState<AdminHouseholdRec[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("Adult Member");
  const [busy, setBusy] = useState<string | null>(null);
  const [minted, setMinted] = useState<InviteRec | null>(null);

  const load = useCallback(async () => {
    setHouseholds(await api.adminHouseholds());
  }, []);
  useFocusEffect(useCallback(() => { if (session?.isOperator) void load(); }, [session?.isOperator, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const mint = async (hh: AdminHouseholdRec) => {
    setBusy(hh.id);
    const r = await api.adminCreateInvite(hh.id, name.trim() || "Invited member", role);
    setBusy(null);
    if (!r.invite) {
      Alert.alert("Couldn't create the code", r.error === "unknown_household" ? "That household no longer exists." : "Something went wrong.");
      return;
    }
    tapHaptic("success");
    setMinted(r.invite);
  };

  // The operator screen is a dead end for everyone else — and says so plainly rather than
  // rendering an empty shell.
  if (!session?.isOperator) {
    return (
      <HScreen>
        <EmptyState
          icon="lock"
          title="Not available"
          hint="This is the platform operator's screen. It isn't part of a household."
          action={{ title: "Back", onPress: () => router.back() }}
        />
      </HScreen>
    );
  }

  if (!households) return <HScreen><SkeletonCards count={3} /></HScreen>;

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <Rise index={0}>
        <Notice
          ok
          text="Every code you mint here is audited, and lands in the household you pick — not yours. Ownership is never grantable by invite."
        />
      </Rise>

      {minted ? (
        <Rise index={1}>
          <Card style={{ gap: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.sage }}>
            <T kind="eyebrow">New code</T>
            <T selectable style={{ ...type.h2Serif, letterSpacing: 2 }} color={colors.text}>{minted.token}</T>
            <T kind="sub">
              {minted.displayName} joins {minted.householdName ?? minted.householdId} as {minted.role}. Expires{" "}
              {new Date(minted.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.
            </T>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <PressableScale
                haptic="select"
                onPress={() => void Share.share({ message: `Your FamiliOS invite code: ${minted.token}` })}
                accessibilityRole="button" accessibilityLabel="Share this code"
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border }}
              >
                <Sym name="square.and.arrow.up" size={13} color={colors.ember} />
                <T kind="subMedium" color={colors.ember}>Share</T>
              </PressableScale>
              <PressableScale
                haptic="select" onPress={() => setMinted(null)}
                accessibilityRole="button" accessibilityLabel="Dismiss"
                style={{ paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <T kind="subMedium" color={colors.textMuted}>Done</T>
              </PressableScale>
            </View>
          </Card>
        </Rise>
      ) : null}

      <Rise index={2}>
        <SectionHeader title="Who's joining" />
        <Card style={{ gap: spacing.md }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Their name (e.g. GPop)"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="words"
            accessibilityLabel="Name of the person joining"
            style={{
              backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous",
              paddingHorizontal: 14, paddingVertical: 12, ...type.body, color: colors.text,
            }}
          />
          <View style={{ gap: 6 }}>
            <T kind="eyebrow">Role</T>
            <ChipRow>
              {ROLES.map((r) => (
                <Chip key={r} label={r} selected={role === r} onPress={() => setRole(r)} />
              ))}
            </ChipRow>
          </View>
        </Card>
      </Rise>

      <Rise index={3}>
        <SectionHeader title={`Households · ${households.length}`} />
        {households.length === 0 ? (
          <Card><T kind="sub">No households have signed up yet.</T></Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {households.map((h) => (
              <ExpandCard
                key={h.id}
                title={h.name ?? "Unnamed household"}
                icon="house"
                iconColor={colors.lavender}
                iconBg={colors.lavenderBg}
                summary={h.id}
                collapsedSummaryLines={1}
                chips={[
                  { label: `${h.memberCount} member${h.memberCount === 1 ? "" : "s"}`, icon: "person.2" },
                  ...(h.createdAt ? [{ label: `since ${new Date(h.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`, icon: "calendar" }] : []),
                ]}
                action={{
                  label: busy === h.id ? "Minting…" : `Mint a ${role} code`,
                  icon: "ticket",
                  loading: busy === h.id,
                  onPress: () => void mint(h),
                }}
              >
                <T kind="sub">
                  A code seats {name.trim() || "an invited member"} in this household as {role}. They redeem it at
                  sign-up; the code is single-use and expires in a week.
                </T>
              </ExpandCard>
            ))}
          </View>
        )}
      </Rise>
    </HScreen>
  );
}
