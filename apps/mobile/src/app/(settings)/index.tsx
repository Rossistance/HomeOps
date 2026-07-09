// Settings — profile, appearance (in-app dark mode), household members,
// connections at a glance, and the doorway to the deeper legacy screens.
import { useCallback, useState } from "react";
import { Alert, Switch, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Constants from "expo-constants";
import { api, type MemberRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, useThemePref } from "@/theme";
import { HuddleMark } from "@/components/brand";
import {
  T, Card, Row, SectionHeader, SkeletonCards, Rise, HScreen, Button, PressableScale,
} from "@/components/ui";
import { ConnectionSheet, type ConnectionService } from "@/components/sheets/connection-sheet";
import { InviteSheet } from "@/components/sheets/invite-sheet";

export default function SettingsScreen() {
  const { colors, dark, spacing } = useTheme();
  const { pref, setPref } = useThemePref();
  const { session, signOut } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [services, setServices] = useState<ConnectionService[]>([]);
  const [openService, setOpenService] = useState<ConnectionService | null>(null);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const isOwner = session?.role === "Owner";
  const canInvite = session?.role === "Owner" || session?.role === "Adult Admin";

  const load = useCallback(async () => {
    const [mem, provs, conns, hh] = await Promise.all([api.members(), api.providers(), api.connectors(), api.household()]);
    setMembers(mem);
    setHouseholdName(hh?.name ?? null);
    const provServices: ConnectionService[] = provs.map((p) => ({
      id: p.id, name: p.name, readiness: p.readiness,
      connected: (p.accounts?.length ?? 0) > 0,
      kind: "provider" as const,
    }));
    const connServices: ConnectionService[] = conns
      .filter((c) => !provs.some((p) => p.id === c.id))
      .map((c) => ({
        id: c.id, name: c.name, readiness: c.readiness,
        connected: /connected|authorized/.test(c.readiness) || c.live,
        kind: "connector" as const,
      }));
    setServices([...provServices, ...connServices].slice(0, 6));
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const initials = (session?.actorName ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("");
  const version = Constants.expoConfig?.version ?? "1.0";

  const renameHousehold = () => {
    Alert.prompt?.(
      "Rename household",
      "This name appears on briefings, invites and the lock screen.",
      async (name) => {
        const n = (name ?? "").trim();
        if (!n) return;
        const r = await api.renameHousehold(n);
        if (r.household) { setHouseholdName(r.household.name); }
        else Alert.alert("Couldn't rename", r.error === "insufficient_role" ? "Only the Owner can rename the household." : r.message ?? "Try again.");
      },
      "plain-text",
      householdName ?? "",
    );
  };

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "You'll pick your profile again next time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <Rise index={0}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <LinearGradient
            colors={[colors.hero1, colors.hero2]}
            start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }}
            style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}
          >
            <T kind="bodyMedium" color={colors.heroText} style={{ fontWeight: "600" }}>{initials}</T>
          </LinearGradient>
          <View style={{ flex: 1, gap: 2 }}>
            <T kind="rowTitle">{session?.actorName}</T>
            <T kind="detail">{session?.role}{householdName ? ` · ${householdName}` : ""}</T>
          </View>
        </Card>
      </Rise>

      <Rise index={1}>
        <SectionHeader title="Appearance" />
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T kind="rowTitle">Dark mode</T>
              <T kind="detail">{pref === "system" ? "Matching your device" : "Set manually"}</T>
            </View>
            {pref !== "system" && (
              <PressableScale onPress={() => setPref("system")} haptic="select" hitSlop={8}>
                <T kind="subMedium" color={colors.ember}>Match system</T>
              </PressableScale>
            )}
            <Switch value={dark} onValueChange={(v) => setPref(v ? "dark" : "light")} trackColor={{ true: colors.ember }} />
          </View>
        </Card>
      </Rise>

      {loading ? <SkeletonCards count={2} /> : (
        <>
          <Rise index={2}>
            <SectionHeader
              title={householdName ?? "Household"}
              trailing={isOwner ? (
                <PressableScale onPress={renameHousehold} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Rename household">
                  <T kind="subMedium" color={colors.ember}>Rename</T>
                </PressableScale>
              ) : undefined}
            />
            <Card padded={false}>
              {members.map((m, i) => (
                <Row
                  key={m.actorId}
                  icon="person.fill"
                  iconColor={colors.ember}
                  iconBg={colors.emberBg}
                  title={`${m.displayName}${m.isCurrentUser ? " — you" : ""}`}
                  subtitle={m.relationship ?? m.role}
                  last={false}
                />
              ))}
              {canInvite && (
                <Row
                  icon="plus"
                  iconColor={colors.ember}
                  iconBg={colors.emberBg}
                  title="Invite someone"
                  subtitle="Add a family member or helper"
                  chevron
                  onPress={() => setInviteOpen(true)}
                  last={false}
                />
              )}
              <Row
                icon="person.2"
                iconColor={colors.sky}
                iconBg={colors.skyBg}
                title="Manage household"
                subtitle="Members, spaces and roles"
                chevron
                onPress={() => router.push("/household")}
                last
              />
            </Card>
          </Rise>

          <Rise index={3}>
            <SectionHeader title="Connections" />
            <Card padded={false}>
              {services.map((s) => (
                <Row
                  key={s.id}
                  icon="link"
                  iconColor={s.connected ? colors.sage : colors.amber}
                  iconBg={s.connected ? colors.sageBg : colors.amberBg}
                  title={s.name}
                  subtitle={s.connected ? "Connected" : "Setup required"}
                  chevron
                  onPress={() => setOpenService(s)}
                  last={false}
                />
              ))}
              <Row
                icon="calendar"
                iconColor={colors.sky}
                iconBg={colors.skyBg}
                title="All connections & calendars"
                subtitle="OAuth accounts, feeds, connectors"
                chevron
                onPress={() => router.push("/connections")}
                last
              />
            </Card>
          </Rise>
        </>
      )}

      <Rise index={4}>
        <SectionHeader title="More" />
        <Card padded={false}>
          <Row icon="checklist" iconColor={colors.lavender} iconBg={colors.lavenderBg} title="Tasks & Lists" chevron onPress={() => router.push("/tasks")} />
          <Row icon="fork.knife" iconColor={colors.sage} iconBg={colors.sageBg} title="Meals" chevron onPress={() => router.push("/meals")} />
          <Row icon="person.2" iconColor={colors.sky} iconBg={colors.skyBg} title="Contacts" chevron onPress={() => router.push("/contacts")} />
          <Row icon="clock" iconColor={colors.amber} iconBg={colors.amberBg} title="Automations" chevron onPress={() => router.push("/automations")} />
          <Row icon="doc.text" iconColor={colors.textMuted} iconBg={colors.surfaceSunken} title="Playbooks" chevron onPress={() => router.push("/playbooks")} />
          <Row icon="cpu" iconColor={colors.ember} iconBg={colors.emberBg} title="AI Providers" chevron onPress={() => router.push("/ai")} last />
        </Card>
      </Rise>

      <Rise index={5}>
        <Card>
          <Button title="Sign out" variant="danger" onPress={confirmSignOut} full />
        </Card>
      </Rise>

      <Rise index={6}>
        <View style={{ alignItems: "center", gap: 6, marginTop: spacing.sm }}>
          <HuddleMark size={28} />
          <T kind="detail">FamiliOS {version}{householdName ? ` · ${householdName}` : ""} · Hearth — {dark ? "Dark" : "Light"}</T>
        </View>
      </Rise>

      <ConnectionSheet
        service={openService}
        visible={!!openService}
        onClose={() => setOpenService(null)}
        onChanged={() => void load()}
      />
      <InviteSheet visible={inviteOpen} onClose={() => setInviteOpen(false)} householdName={householdName} onInvited={() => void load()} />
    </HScreen>
  );
}
