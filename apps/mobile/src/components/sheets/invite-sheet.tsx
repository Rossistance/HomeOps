// Invite-a-member sheet (3 steps, per handoff) — and it's real: sending creates
// an actual member record on the server (their profile appears on the family
// lock screen immediately), registers their contact method, and best-effort
// delivers the invite message through the household's real channels.
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import {
  T, Well, SymTile, PressableScale, HSheet, SheetCTA, Notice, Sym, useConfirmFlash,
} from "@/components/ui";

/* S3 — "there's a screen here that says 'who are you inviting'. I actually do not believe these
 * are the correct categories that we base things off of in the application. The grandparent
 * term was thrown out at one point. However, it's adult admin, adult member, limited member,
 * helper."
 *
 * Right, and the mismatch was doing real harm: the picker offered "Grandparent", the SERVER
 * enforces Limited Member, and the two aren't the same idea. A grandparent might be an Adult
 * Member with full standing (that's the routing fix from an earlier review) or a Limited Member
 * — the relationship and the role are different questions, and one control was answering both.
 *
 * These are the roles the server actually has. Access below is what each one actually grants,
 * server-enforced; no pretend toggles. Relationship is set separately on the member, where it
 * belongs, and no longer smuggled in through the invite.
 */
const ROLE_CARDS = [
  { key: "adult-admin", name: "Adult Admin", icon: "shield", serverRole: "Adult Admin", relationship: null,
    desc: "Runs the household with you — everything you can do, except deleting it",
    access: ["Everything an Adult Member has", "Invites and removes members", "Approves anything leaving the house", "Changes household settings"],
    line: "You'll help run the household — the calendar, the people, and what goes out." },
  { key: "adult-member", name: "Adult Member", icon: "person", serverRole: "Adult Member", relationship: null,
    desc: "Full member — their own calendar, helpers and chats, and the family's too",
    access: ["Family calendar & chores", "Meals, groceries and lists", "Their own connected accounts", "Their own helpers and private chats"],
    line: "You'll see the family calendar and the shared spaces, and have your own side of the app." },
  { key: "limited-member", name: "Limited Member", icon: "person.2", serverRole: "Limited Member", relationship: null,
    desc: "The calendar and the lists, without the household's admin",
    access: ["The family calendar", "Shared lists they can add to", "Family updates and notes", "No approvals, no settings"],
    line: "You'll see the family calendar, the lists, and what's going on." },
  { key: "helper", name: "Helper", icon: "clock", serverRole: "Guest/Helper", relationship: "Helper",
    desc: "The schedule and care notes, while they're helping",
    access: ["The schedule while helping", "Care notes shared with them", "No bills, files or approvals"],
    line: "You'll see the schedule and care notes while you're helping." },
  { key: "child", name: "Child", icon: "graduationcap", serverRole: "Child View", relationship: "Child",
    desc: "Chores and the calendar — everything else stays with you",
    access: ["Their own chore list", "The family calendar", "Nothing external — ever"],
    line: "You'll see your chores and the family calendar." },
] as const;

export function InviteSheet({ visible, onClose, householdName, onInvited }: {
  visible: boolean;
  onClose: () => void;
  householdName: string | null;
  onInvited: () => void;
}) {
  const { colors, spacing } = useTheme();
  const { flash, show } = useConfirmFlash();
  const { session } = useSession();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [roleKey, setRoleKey] = useState<string>("adult");
  const [method, setMethod] = useState<"Phone/Text" | "Email">("Phone/Text");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Identity households (email sign-in, hh_*) invite with a JOIN CODE: the
  // person creates their own login and lands in this household with the chosen
  // role. The resident device-shared household keeps its profile-record flow.
  const identityHousehold = !!session?.householdId?.startsWith("hh_");
  const [joinCode, setJoinCode] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setStep(0); setName(""); setRoleKey("adult"); setMethod("Phone/Text"); setContact(""); setNote(null); setBusy(false); setJoinCode(null); }
  }, [visible]);

  const role = ROLE_CARDS.find((r) => r.key === roleKey) ?? ROLE_CARDS[0];
  const first = name.trim().split(" ")[0] || "there";
  const household = householdName ?? "our household";

  // Identity households mint the join code when the send step opens, so the
  // preview shows exactly what will be sent.
  useEffect(() => {
    if (!visible || step !== 2 || !identityHousehold || joinCode) return;
    void api.createInvite({ displayName: name.trim() || "Family member", role: role.serverRole }).then((r) => {
      if (r.invite) setJoinCode(r.invite.token);
      else setNote(r.error === "insufficient_role" ? "Only an Owner or Adult Admin can invite members." : "Couldn't create a join code — try again.");
    });
  }, [visible, step, identityHousehold, joinCode, name, role.serverRole]);

  const preview = useMemo(() =>
    identityHousehold
      ? `Hi ${name.trim() ? first : "there"} — you're invited to ${household} on FamiliOS. ${role.line}\n\nOpen the app (or the web app), choose "Create or join", and enter join code ${joinCode ?? "…"} with your own email and password.`
      : `Hi ${name.trim() ? first : "there"} — you've been added to ${household} on FamiliOS. ${role.line}\n\nInstall the app from the TestFlight invite that's on its way, then pick your name on the welcome screen.`,
  [identityHousehold, name, first, household, role, joinCode]);

  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? true : contact.trim().length > 0;

  async function sendInvite() {
    if (busy) return;
    setBusy(true); setNote(null);
    if (identityHousehold) {
      // Identity household: the join CODE is the invite — the person creates
      // their own login and the member record appears when they redeem it.
      if (!joinCode) { setBusy(false); setNote("The join code isn't ready yet — give it a second and try again."); return; }
      const sent = await api.notify({ methodType: method, to: contact.trim(), title: `You're invited to ${household}`, body: preview });
      setBusy(false);
      if (!sent.ok || sent.needsSetup) {
        Alert.alert(
          "Share the join code",
          `The invite message couldn't be sent${sent.needsSetup ? ` (${method === "Email" ? "email" : "texting"} isn't set up yet)` : ""}. Share this code with ${first} directly:\n\n${joinCode}\n\nIt works for 7 days and can be used once.`,
          [{ text: "Done", onPress: () => { onInvited(); onClose(); } }],
        );
        return;
      }
      show("send", () => { onInvited(); onClose(); });
      return;
    }
    // 1) The real invite: a member record. Their profile exists from this moment.
    const created = await api.createMember({ displayName: name.trim(), role: role.serverRole, relationship: role.relationship });
    if (!created.member) {
      setBusy(false);
      setNote(created.error === "insufficient_role" ? "Only an Owner or Adult Admin can invite members."
        : created.error === "actor_exists" ? "Someone with that profile already exists."
        : created.message ?? "Couldn't add the member — try again.");
      return;
    }
    // 2) Register how to reach them (powers future notifications/texted grocery adds).
    await api.createContactMethod({ memberId: created.member.actorId, label: "Invite contact", type: method, value: contact.trim() }).catch(() => null);
    // 3) Best-effort invite message through the household's real channel.
    const sent = await api.notify({ methodType: method, to: contact.trim(), title: `Welcome to ${household}`, body: preview });
    setBusy(false);
    if (!sent.ok || sent.needsSetup) {
      // Member exists either way — be honest that the message didn't go out.
      Alert.alert(
        `${first} was added to the household`,
        `Their profile is ready to use, but the invite message couldn't be sent${sent.needsSetup ? ` (${method === "Email" ? "email" : "texting"} isn't set up yet)` : ""}. Share your TestFlight link with them directly.`,
        [{ text: "OK", onPress: () => { onInvited(); onClose(); } }],
      );
      return;
    }
    show("send", () => { onInvited(); onClose(); });
  }

  function next() {
    tapHaptic("light");
    if (step < 2) { setStep(step + 1); return; }
    void sendInvite();
  }

  return (
    <>
      <HSheet
        visible={visible} onClose={onClose} title={`Invite · ${step + 1} of 3`} leftLabel={step === 0 ? "Cancel" : "Close"} heightPct={0.84}
        footer={
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ height: 6, borderRadius: 3, width: i === step ? 20 : 6, backgroundColor: i === step ? colors.ember : colors.textFaint }} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {step > 0 && (
                <PressableScale onPress={() => setStep(step - 1)} style={{ flex: 1, height: 52, borderRadius: 15, borderCurve: "continuous", backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
                  <T kind="bodyMedium" color={colors.textSecondary} style={{ fontWeight: "600" }}>Back</T>
                </PressableScale>
              )}
              <View style={{ flex: 1.6 }}>
                <SheetCTA title={step === 2 ? (busy ? "Sending…" : "Send invite") : "Continue"} onPress={next} disabled={!canNext || busy} />
              </View>
            </View>
          </View>
        }
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
          {note && <Notice text={note} ok={false} />}

          {step === 0 && (
            <>
              <T kind="h2">Who are you inviting?</T>
              <Well style={{ padding: 0 }}>
                <TextInput
                  value={name} onChangeText={setName}
                  placeholder="Their name"
                  placeholderTextColor={colors.textFaint}
                  style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
                />
              </Well>
              <View style={{ gap: 8 }}>
                {ROLE_CARDS.map((r) => {
                  const on = roleKey === r.key;
                  return (
                    <PressableScale
                      key={r.key}
                      onPress={() => { tapHaptic("select"); setRoleKey(r.key); }}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 12, padding: 13,
                        borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.surface,
                        borderWidth: on ? 1.5 : 1, borderColor: on ? colors.ember : colors.border,
                      }}
                    >
                      <SymTile name={r.icon} color={on ? colors.ember : colors.textMuted} bg={on ? colors.emberBg : colors.surfaceSunken} size={40} iconSize={18} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="rowTitle">{r.name}</T>
                        <T kind="detail">{r.desc}</T>
                      </View>
                      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: on ? colors.ember : colors.textFaint, backgroundColor: on ? colors.ember : "transparent", alignItems: "center", justifyContent: "center" }}>
                        {on && <Sym name="checkmark" size={12} color={colors.onEmber} />}
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            </>
          )}

          {step === 1 && (
            <>
              <T kind="h2">What {name.trim() ? first : "they"} will see</T>
              <View style={{ gap: 8 }}>
                {role.access.map((a) => (
                  <View key={a} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Sym name="checkmark" size={14} color={colors.sage} />
                    <T kind="body" style={{ flex: 1 }}>{a}</T>
                  </View>
                ))}
              </View>
              <Well>
                <T kind="detail">
                  {first} only sees what their role allows — and nothing an agent does for them leaves the household without your approval. You can change or remove their access anytime from Settings → Household.
                </T>
              </Well>
            </>
          )}

          {step === 2 && (
            <>
              <T kind="h2">Send the invite</T>
              <View style={{ flexDirection: "row", backgroundColor: colors.surfaceSunken, borderRadius: 12, borderCurve: "continuous", padding: 3, gap: 2 }}>
                {(["Phone/Text", "Email"] as const).map((m) => (
                  <PressableScale key={m} onPress={() => { tapHaptic("select"); setMethod(m); }} haptic={null}
                    style={{ flex: 1, paddingVertical: 8, borderRadius: 9, borderCurve: "continuous", alignItems: "center", backgroundColor: method === m ? colors.surface : "transparent" }}>
                    <T kind="caption" color={method === m ? colors.text : colors.textSecondary} style={{ fontSize: 12.5 }}>{m === "Phone/Text" ? "Text message" : "Email"}</T>
                  </PressableScale>
                ))}
              </View>
              <Well style={{ padding: 0 }}>
                <TextInput
                  value={contact} onChangeText={setContact}
                  placeholder={method === "Email" ? "name@example.com" : "(555) 010-1234"}
                  placeholderTextColor={colors.textFaint}
                  keyboardType={method === "Email" ? "email-address" : "phone-pad"}
                  autoCapitalize="none"
                  style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
                />
              </Well>
              <View style={{ gap: 6 }}>
                <T kind="eyebrow">They'll get</T>
                <Well>
                  <T kind="sub" color={colors.textSecondary}>{preview}</T>
                </Well>
              </View>
              <T kind="detail" center>
                TestFlight access itself is sent from App Store Connect —{"\n"}add their email there or share your public TestFlight link.
              </T>
            </>
          )}
        </ScrollView>
      </HSheet>
      {flash}
    </>
  );
}
