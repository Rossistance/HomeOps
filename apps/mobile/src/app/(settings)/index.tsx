// Settings — profile, appearance (in-app dark mode), household members,
// connections at a glance, and the doorway to the deeper legacy screens.
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Switch, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Constants from "expo-constants";
import { api, type MemberRec } from "@/lib/api";
import { memberAccent } from "@/lib/member-colors";
import { roleAtLeast } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { ColorPicker } from "@/components/ui/color-picker";
import { useTheme, useThemePref, tapHaptic } from "@/theme";
import { HuddleMark } from "@/components/brand";
import {
  T, Card, Chip, ChipRow, Coach, Row, SectionHeader, SkeletonCards, Rise, HScreen, Button, PressableScale,
  HSheet, SheetCTA, Notice, Sym, Well,
} from "@/components/ui";
import { ConnectionSheet, type ConnectionService } from "@/components/sheets/connection-sheet";
import { InviteSheet } from "@/components/sheets/invite-sheet";
import { MemberAvatar } from "@/app/(home)/profile";
import { useTutorial } from "@/lib/tutorial";

export default function SettingsScreen() {
  const { colors, dark, spacing } = useTheme();
  const { start: startTour } = useTutorial();
  const { pref, setPref } = useThemePref();
  const { session, signOut } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [services, setServices] = useState<ConnectionService[]>([]);
  const [openService, setOpenService] = useState<ConnectionService | null>(null);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberRec | null>(null);
  const isOwner = session?.role === "Owner";
  const canInvite = session?.role === "Owner" || session?.role === "Adult Admin";
  const canManage = roleAtLeast(session?.role, "Adult Admin");

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
  // The signed-in person's own roster record — carries their photo, emoji and colour.
  const meMember = members.find((m) => m.isCurrentUser || m.actorId === session?.actorId) ?? null;
  const version = Constants.expoConfig?.version ?? "1.0";

  // Revoking an invite = archiving the member. Their profile disappears from the
  // lock screen everywhere and any pending invite they got stops working.
  const removeMember = (m: MemberRec) => {
    Alert.alert(
      `Remove ${m.displayName.split(" ")[0]}?`,
      "Their profile disappears from every device and any invite they received stops working.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: async () => {
            const r = await api.deleteMember(m.actorId);
            if (r.error) {
              Alert.alert("Couldn't remove", r.error === "insufficient_role" ? "Only an Owner or Adult Admin can remove members." : r.message ?? "Try again.");
            }
            void load();
          },
        },
      ],
    );
  };

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

  // In-app account deletion (App Store Review 5.1.1(v)). The server decides the blast
  // radius from the caller's role and it is NOT symmetric — an Owner deletes the whole
  // household — so the copy is role-aware and the final Alert repeats the consequence
  // one last time before anything irreversible happens.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);

  const runDelete = async () => {
    setDeleting(true); setDeleteNote(null);
    const r = await api.deleteMyAccount(deletePassword);
    setDeleting(false);
    if (r.ok) {
      tapHaptic("success");
      setDeletePassword("");
      // The server has already cleared the session server-side; signOut clears this
      // device's stored token and returns to the Lock screen.
      await signOut();
      return;
    }
    tapHaptic("error");
    setDeletePassword("");
    setDeleteNote(
      r.error === "password_incorrect" ? "That password didn't match. Nothing was deleted."
        : r.error === "not_identity_account" ? (r.message ?? "This profile signs in without an email account, so there's no account to delete. An Owner can remove the member from Settings → Household.")
        : r.error === "network" ? "Couldn't reach the server, so nothing was deleted. Check your connection and try again."
        : r.message ?? "Couldn't delete the account. Nothing was changed.",
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      isOwner ? `Delete ${householdName ?? "this household"}?` : "Delete your account?",
      isOwner
        ? "This permanently removes the household and everything in it for every member. It cannot be undone."
        : "This permanently removes your account and your access to this household. It cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: isOwner ? "Delete household" : "Delete account", style: "destructive", onPress: () => void runDelete() },
      ],
    );
  };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh} keyboardAware>
      <Rise index={0}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {/* S1 — "while I do have a profile photo for myself here, it's not replicated at the
              top of the Settings page inside my badge." MemberAvatar already knows how to fall
              back to an emoji or an initial in the member's own colour, so the initials
              gradient was doing a worse version of a job something else already did. */}
          {meMember
            ? <MemberAvatar member={meMember} size={48} />
            : (
              <LinearGradient
                colors={[colors.hero1, colors.hero2]}
                start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }}
                style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}
              >
                <T kind="bodyMedium" color={colors.heroText} style={{ fontWeight: "600" }}>{initials}</T>
              </LinearGradient>
            )}
          <View style={{ flex: 1, gap: 2 }}>
            <T kind="rowTitle">{session?.actorName}</T>
            <T kind="detail">{session?.role}{householdName ? ` · ${householdName}` : ""}</T>
          </View>
        </Card>
      </Rise>

      {/* V1 — "there's no need for this card at the bottom of the screen for appearance; it
          actually doesn't do anything, there's really no point for that" (other than on web).
          It does do something — but dark now ships as the default and the switch was a row of
          chrome on a screen he wants shorter. It moved to the bottom, under More, where a
          preference belongs; it is not deleted, because someone who wants light mode still
          needs a way to say so. */}


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
            <Coach id="settings.household">
            <Card padded={false}>
              {members.map((m) => {
                const removable = canInvite && !m.isCurrentUser && m.role !== "Owner";
                // Owners/Adult Admins edit anyone; everyone can self-serve name + color.
                const editable = canManage || m.isCurrentUser;
                return (
                  <Row
                    key={m.actorId}
                    // B5/B6: was a generic person glyph — "each member here has just a
                    // generic person icon, they need their profile pictures here… each one
                    // should be designated by color, so it's easily identifiable."
                    // MemberAvatar already renders the real photo (or emoji) inside the
                    // member's own accent ring.
                    leading={<MemberAvatar member={m} size={38} />}
                    iconColor={memberAccent(colors, m.color) ?? colors.ember}
                    iconBg={colors.emberBg}
                    title={`${m.displayName}${m.isCurrentUser ? " — you" : ""}`}
                    subtitle={`${m.relationship ?? m.role}${editable ? " · tap to edit" : ""}${removable ? " · hold to remove" : ""}`}
                    onPress={editable ? () => setEditingMember(m) : undefined}
                    onLongPress={removable ? () => removeMember(m) : undefined}
                    last={false}
                  />
                );
              })}
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
            </Coach>
          </Rise>

          <Rise index={3}>
            <SectionHeader title="Connections" />
            <Coach id="settings.connections">
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
            </Coach>
          </Rise>
        </>
      )}

      <Rise index={4}>
        {/* Show me around — the walkthrough's front door, and the last stop on it. Above
            "More" rather than buried in it: this is the row a lost person is looking for, and
            everything below it is the stuff they'd be lost among. */}
        <Coach id="settings.tutorial">
        <Card padded={false} style={{ marginBottom: spacing.md }}>
          <Row
            icon="hand.tap"
            iconColor={colors.ember}
            iconBg={colors.emberBg}
            title="Show me around"
            subtitle="A short walkthrough, pointing at the real thing"
            chevron
            /* No navigation here — the tour owns routing, and pushing Today first would leave
               an extra screen on the stack for it to walk back out of. */
            onPress={startTour}
            last
          />
        </Card>
        </Coach>

        <SectionHeader title="More" />
        <Card padded={false}>
          {/* BUG-04 — the Tasks & Lists and Meals rows are gone from here on purpose: they
              pushed those screens onto the SETTINGS stack, which is why Back from a task
              landed on Settings. "These two need to be removed. They exist on the today
              page. It can be accessed there." */}
          <Row icon="person.2" iconColor={colors.sky} iconBg={colors.skyBg} title="Contacts" chevron onPress={() => router.push("/contacts")} />
          {/* Nests — a small group inside the household. Any adult can form one; it grants no
              authority over anyone, so there is no role gate beyond that. */}
          <Row icon="person.2.fill" iconColor={colors.lavender} iconBg={colors.lavenderBg} title="Nests" subtitle="A shared space for just some of you" chevron onPress={() => router.push("/nests")} />
          <Row icon="clock" iconColor={colors.amber} iconBg={colors.amberBg} title="Automations" chevron onPress={() => router.push("/automations")} />
          <Row icon="doc.text" iconColor={colors.textMuted} iconBg={colors.surfaceSunken} title="Playbooks" chevron onPress={() => router.push("/playbooks")} />
          <Row icon="cpu" iconColor={colors.ember} iconBg={colors.emberBg} title="AI Providers" chevron onPress={() => router.push("/ai")} last={!session?.isOperator} />
          {/* D5 — only the platform operator sees this row at all. "New households do not get
              this," in his words: it isn't a household feature. */}
          {session?.isOperator ? (
            <Row icon="ticket" iconColor={colors.lavender} iconBg={colors.lavenderBg} title="Operator · invite codes" subtitle="Mint a join code for any household" chevron onPress={() => router.push("/operator")} last />
          ) : null}
        </Card>
      </Rise>

      {/* Moved down here from the top of the screen. It's a preference, not something you came
          to Settings to do — and dark is the default now, so most people never touch it. */}
      <Rise index={5}>
        <SectionHeader title="Appearance" />
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T kind="rowTitle">Dark mode</T>
              <T kind="detail">{pref === "system" ? "Matching your device" : pref === "dark" ? "Dark" : "Light"}</T>
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

      <Rise index={5}>
        <Card>
          <Button title="Sign out" variant="danger" onPress={confirmSignOut} full />
        </Card>
      </Rise>

      {/* Apple requires in-app account deletion for any app that lets you create an
          account (App Store Review 5.1.1(v)); there was no mobile entry point at all.
          Rendered inline rather than as a system dialog on purpose: this is irreversible,
          and for an Owner it deletes the WHOLE household — that consequence should stay
          on screen while you type your password, not flash past in a transient alert. */}
      <Rise index={6}>
        <SectionHeader title="Danger zone" />
        <Card style={{ gap: spacing.md }}>
          {!deleteOpen ? (
            <>
              <T kind="sub">
                {isOwner
                  ? "Deleting your account removes the entire household — every member, event, task, file, and helper. It cannot be undone."
                  : "Deleting your account removes your sign-in and your access to this household. Shared household data stays with the family."}
              </T>
              {/* V2 — "the delete my account button is a little large, and given that there's an
                  infinite scroll error on this page it presents itself as an issue and is
                  potentially able to be hit by accident. A better idea would be to put an
                  additional step here, and it'd be greyed out until your PIN was put in —
                  either a PIN or your username or email — which would then relieve it, and
                  then a toast afterwards to confirm."
                  So: small and ghosted, not a full-width red bar competing with Sign out. The
                  identity check he described already guards the step behind it. */}
              <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                <Button
                  title="Delete my account" variant="ghost" small
                  onPress={() => { setDeleteOpen(true); setDeleteNote(null); }}
                />
              </View>
            </>
          ) : (
            <>
              <T kind="bodyMedium" color={colors.coral}>
                {isOwner ? `This deletes ${householdName ?? "your household"} for everyone` : "This deletes your account"}
              </T>
              <T kind="sub">
                {isOwner
                  ? "Every member, event, task, file, recipe, and helper in this household is permanently removed. Other members lose access immediately. This cannot be undone."
                  : "You'll be signed out and lose access to this household. The family's shared data is not affected. This cannot be undone."}
              </T>
              <T kind="detail">Enter your account password to confirm.</T>
              <TextInput
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                placeholder="Password"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="Account password, to confirm deletion"
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.surfaceSunken }}
              />
              {deleteNote ? <Notice text={deleteNote} ok={false} /> : null}
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="ghost" full disabled={deleting} onPress={() => { setDeleteOpen(false); setDeletePassword(""); setDeleteNote(null); }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title={deleting ? "Deleting…" : isOwner ? "Delete household" : "Delete account"}
                    variant="danger" full
                    disabled={deleting || deletePassword.length === 0}
                    onPress={confirmDeleteAccount}
                  />
                </View>
              </View>
            </>
          )}
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
      <MemberSheet
        allMembers={members}
        member={editingMember}
        canManage={canManage}
        visible={!!editingMember}
        onClose={() => setEditingMember(null)}
        onSaved={() => { setEditingMember(null); void load(); }}
      />
    </HScreen>
  );
}

/* ------------------------- member editor sheet ------------------------- */

// The 6 server roles, highest authority first (must match server/auth.mjs).
const ALL_ROLES = ["Owner", "Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"] as const;
// Named accents the server stores in member.color (same set the web uses).
// ACCENTS removed — the shared ColorPicker (lib/member-colors) is the single source.

/** Edit a member. Owners/Adult Admins get the full editor (role, relationship,
 * child AI toggle); everyone else gets self-service name + color. The server
 * enforces the real rules — last-owner demotion comes back as 409 last_owner. */
function MemberSheet({ member, canManage, visible, onClose, onSaved, allMembers = [] }: {
  member: MemberRec | null;
  allMembers?: MemberRec[];
  canManage: boolean;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, spacing } = useTheme();
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [role, setRole] = useState<string>("Adult Member");
  const [color, setColor] = useState<string | null>(null);
  // Everyone whose colour this member must not collide with — the roster minus themselves.
  const othersFor = (m: MemberRec | null) => allMembers.filter((x) => x.actorId !== m?.actorId);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !member) return;
    setName(member.displayName);
    setRelationship(member.relationship ?? "");
    setRole(member.role);
    setColor(member.color ?? null);
    setAiEnabled(!!member.aiEnabled);
    setBusy(false);
    setNote(null);
  }, [visible, member]);

  // AI-chat toggle applies to child profiles (role or relationship says child).
  const showAiToggle = canManage && (role === "Child View" || /child|kid|son|daughter/i.test(relationship));

  async function save() {
    if (!member || busy) return;
    setBusy(true); setNote(null);
    // Only send what changed — self-edits may touch name/color/photo only.
    const patch: Parameters<typeof api.patchMember>[1] = {};
    if (name.trim() && name.trim() !== member.displayName) patch.displayName = name.trim();
    if ((color ?? null) !== (member.color ?? null)) patch.color = color;
    if (canManage) {
      const rel = relationship.trim() || null;
      if (rel !== (member.relationship ?? null)) patch.relationship = rel;
      if (role !== member.role) patch.role = role;
      if (showAiToggle && !!member.aiEnabled !== aiEnabled) patch.aiEnabled = aiEnabled;
    }
    if (Object.keys(patch).length === 0) { setBusy(false); onClose(); return; }
    const r = await api.patchMember(member.actorId, patch);
    setBusy(false);
    if (r.member) { tapHaptic("success"); onSaved(); return; }
    setNote(
      r.error === "last_owner" ? "That would leave the household without an Owner — promote someone else to Owner first."
      : r.error === "insufficient_role" ? "Only an Owner or Adult Admin can change roles or other members."
      : r.message ?? `Couldn't save: ${r.error ?? "unknown error"}`,
    );
  }

  if (!member) return null;
  return (
    <HSheet
      visible={visible}
      onClose={onClose}
      title={member.isCurrentUser ? "Edit your profile" : `Edit ${member.displayName.split(" ")[0]}`}
      leftLabel="Cancel"
      heightPct={0.84}
      footer={<SheetCTA title={busy ? "Saving…" : "Save changes"} onPress={() => void save()} disabled={busy || !name.trim()} />}
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        {note ? <Notice text={note} ok={false} /> : null}

        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Name</T>
          <Well style={{ padding: 0 }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Display name"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Display name"
              style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
            />
          </Well>
        </View>

        {canManage ? (
          <View style={{ gap: 6 }}>
            <T kind="eyebrow">Relationship</T>
            <Well style={{ padding: 0 }}>
              <TextInput
                value={relationship}
                onChangeText={setRelationship}
                placeholder="Child, Grandparent, Sitter…"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="Relationship"
                style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
              />
            </Well>
          </View>
        ) : null}

        {canManage ? (
          <View style={{ gap: 6 }}>
            <T kind="eyebrow">Role</T>
            <ChipRow>
              {ALL_ROLES.map((rr) => (
                <Chip key={rr} label={rr} selected={role === rr} onPress={() => setRole(rr)} />
              ))}
            </ChipRow>
            <T kind="detail">The server refuses a change that would leave the household without an Owner.</T>
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <T kind="eyebrow">Color</T>
          {/* BUG-02 — "in the settings page you do have the ability to select a color that
              someone else is already on… and that's not gonna work. The colors have to be
              strict." This editor was the unguarded door: its own six-colour list, no taken
              check, silently displacing whoever held the colour. Same picker as My Profile
              now, same refusal, same spectrum. */}
          <ColorPicker
            value={color}
            onChange={setColor}
            others={othersFor(member)}
          />
          <T kind="detail">Their color on the calendar and around the app — unique per person.</T>
        </View>

        {showAiToggle ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <T kind="rowTitle">AI chat</T>
              <T kind="detail">Let this child talk to Famili in Ask</T>
            </View>
            <Switch value={aiEnabled} onValueChange={setAiEnabled} trackColor={{ true: colors.ember }} />
          </View>
        ) : null}

        {!canManage ? (
          <Well>
            <T kind="detail">You can change your own name and color. Roles and relationships are managed by an Owner or Adult Admin.</T>
          </Well>
        ) : null}
      </ScrollView>
    </HSheet>
  );
}
