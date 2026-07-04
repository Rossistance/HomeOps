import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type ContactMethodRec, type ContactMethodType, type MemberRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Contacts — the server-owned contact-method registry on mobile: each member's
// delivery addresses (email/text/in-app/dashboard) with their real verified and
// opt-in state. Everything here is enforced server-side: adults manage anyone's
// methods, everyone else manages only their own, and agents can only message a
// method that's verified and opted-in.
const TYPES: ContactMethodType[] = ["Email", "Phone/Text", "In-App", "Family Dashboard"];
// In-App and Family Dashboard aren't external addresses — the server assigns their
// fixed channel value and they're born verified (nothing external to confirm).
const NO_ADDRESS: ContactMethodType[] = ["In-App", "Family Dashboard"];
const TYPE_ICON: Record<ContactMethodType, keyof typeof Ionicons.glyphMap> = {
  "Email": "mail-outline",
  "Phone/Text": "phone-portrait-outline",
  "In-App": "notifications-outline",
  "Family Dashboard": "tv-outline",
};

export default function ContactsScreen() {
  const { session } = useSession();
  const isAdult = ["Owner", "Adult Admin", "Adult Member"].includes(session?.role ?? "");
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [methods, setMethods] = useState<ContactMethodRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Composer
  const [composerOpen, setComposerOpen] = useState(false);
  const [forMember, setForMember] = useState<string | null>(null);
  const [type, setType] = useState<ContactMethodType>("Email");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  // Verification loop
  const [codeEntryId, setCodeEntryId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [manualOfferId, setManualOfferId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, cm] = await Promise.all([api.members(), api.contactMethods()]);
    setMembers(m); setMethods(cm);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Non-adults may only add/manage their own methods — mirror the server's gate
  // honestly instead of offering buttons that would 403.
  const canManage = useCallback((memberId: string) => isAdult || memberId === session?.actorId, [isAdult, session?.actorId]);
  const addableMembers = useMemo(() => (isAdult ? members : members.filter((m) => m.actorId === session?.actorId)), [isAdult, members, session?.actorId]);
  const byMember = useMemo(() => {
    const map: Record<string, ContactMethodRec[]> = {};
    for (const c of methods) (map[c.memberId] ??= []).push(c);
    return map;
  }, [methods]);

  const add = async () => {
    const memberId = forMember ?? session?.actorId;
    if (!label.trim() || !memberId) return;
    setBusy("add"); setNotice(null);
    const r = await api.createContactMethod({ memberId, label: label.trim(), type, value: NO_ADDRESS.includes(type) ? undefined : value.trim() });
    setBusy(null);
    if (r.contactMethod) {
      setLabel(""); setValue(""); setComposerOpen(false);
      setNotice({ text: r.contactMethod.verified ? "Contact method added." : "Contact method added — verify it before agents can message it.", ok: true });
      await load();
    } else {
      setNotice({
        text: r.error === "insufficient_role" ? "You can only add contact methods for yourself."
          : r.error === "invalid_value" ? (type === "Email" ? "Enter a valid email address." : "Enter a valid phone number.")
          : `Couldn't add: ${r.message ?? r.error ?? "unknown error"}`,
        ok: false,
      });
    }
  };

  // The true verification loop: request a code through the method's real channel,
  // then enter it below. The adult-only manual override is offered only when the
  // channel honestly can't deliver a code yet.
  const startVerify = async (c: ContactMethodRec) => {
    setBusy(`v:${c.id}`); setNotice(null); setManualOfferId(null);
    const r = await api.sendContactVerification(c.id);
    setBusy(null);
    if (r.ok) {
      setCodeEntryId(c.id); setCode("");
      setNotice({ text: r.message ?? "Code sent — enter the 6 digits below.", ok: true });
    } else if (r.needsSetup) {
      if (isAdult) setManualOfferId(c.id);
      setNotice({ text: r.message ?? "That channel needs setup in Connections before a code can be sent.", ok: false });
    } else if (r.error === "resend_too_soon") {
      setCodeEntryId(c.id);
      setNotice({ text: r.message ?? "A code was just sent — enter it below.", ok: true });
    } else {
      setNotice({ text: r.message ?? `Couldn't send a code: ${r.error ?? "unknown error"}`, ok: false });
    }
  };
  const confirmVerify = async (c: ContactMethodRec) => {
    if (!/^\d{6}$/.test(code.trim())) return;
    setBusy(`c:${c.id}`);
    const r = await api.confirmContactVerification(c.id, code.trim());
    setBusy(null);
    if (r.ok || r.alreadyVerified) {
      setCodeEntryId(null); setCode("");
      setNotice({ text: `“${c.label}” verified — agents can now message it.`, ok: true });
      await load();
    } else {
      setNotice({ text: r.message ?? (r.error === "code_incorrect" ? `That code doesn't match${r.attemptsLeft != null ? ` — ${r.attemptsLeft} attempts left` : ""}.` : `Couldn't verify: ${r.error ?? "unknown error"}`), ok: false });
    }
  };
  // Adult-only manual override, recorded server-side as verifiedVia:"manual".
  const manualVerify = async (c: ContactMethodRec) => {
    setBusy(`v:${c.id}`); setNotice(null); setManualOfferId(null);
    const r = await api.patchContactMethod(c.id, { verified: true, optInStatus: "Opted In" });
    setBusy(null);
    if (r.contactMethod) { setNotice({ text: `“${c.label}” marked verified (manual override).`, ok: true }); await load(); }
    else setNotice({ text: r.message ?? `Couldn't verify: ${r.error ?? "unknown error"}`, ok: false });
  };

  // Real delivery attempt through the method's channel, resolved server-side from
  // the registry — reports the honest outcome (delivered / which service needs setup).
  const sendTest = async (c: ContactMethodRec) => {
    setBusy(`t:${c.id}`); setNotice(null);
    const r = await api.notify({ methodId: c.id, title: "HomeOps test", body: `This is a test notification to your “${c.label}” contact method.` });
    setBusy(null);
    if (r.delivered) setNotice({ text: r.message ?? "Test delivered.", ok: true });
    else if (r.needsSetup) setNotice({ text: r.message ?? "That channel needs setup in Connections first.", ok: false });
    else setNotice({ text: r.message ?? `Couldn't deliver: ${r.error ?? "unknown error"}`, ok: false });
  };

  const remove = async (c: ContactMethodRec) => {
    setBusy(`d:${c.id}`); setNotice(null);
    const r = await api.deleteContactMethod(c.id);
    setBusy(null);
    if (r.error) setNotice({ text: r.error === "insufficient_role" ? "You can only remove your own contact methods." : `Couldn't remove: ${r.error}`, ok: false });
    else setNotice({ text: "Contact method removed.", ok: true });
    await load();
  };

  const selectedMember = forMember ?? session?.actorId ?? null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <View style={st.headRow}>
          <View style={{ flex: 1 }}><H1>Contacts</H1></View>
          <Pressable
            onPress={() => setComposerOpen((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={composerOpen ? "Close new contact method form" : "Add a contact method"}>
            <Ionicons name={composerOpen ? "close-circle-outline" : "add-circle-outline"} size={28} color={Hearth.ember500} />
          </Pressable>
        </View>
        <Muted style={{ marginTop: 4 }}>How the family gets reached. Agents can only message a method that&apos;s verified and opted-in.</Muted>
        {!isAdult && <Muted style={{ marginTop: 6, fontSize: 12 }}>You can manage your own methods; changing someone else&apos;s needs an adult.</Muted>}

        {notice ? (
          <View style={[st.notice, { backgroundColor: notice.ok ? Hearth.sageBg : Hearth.coralBg, borderColor: notice.ok ? Hearth.sage500 : Hearth.coral500 }]}>
            <Body style={{ color: notice.ok ? Hearth.sage600 : Hearth.coral600, fontSize: 14 }}>{notice.text}</Body>
          </View>
        ) : null}

        {composerOpen && (
          <Card style={{ marginTop: 12, gap: 8 }}>
            {addableMembers.length > 1 && (
              <View style={st.chipRow}>
                {addableMembers.map((m) => (
                  <Pressable
                    key={m.actorId}
                    onPress={() => setForMember(m.actorId)}
                    style={[st.chip, selectedMember === m.actorId && st.chipActive]}
                    accessibilityRole="button"
                    accessibilityLabel={`For ${m.displayName}${selectedMember === m.actorId ? ", selected" : ""}`}>
                    <Body style={{ fontSize: 13, fontWeight: "600", color: selectedMember === m.actorId ? Hearth.white : Hearth.ink600 }}>{m.displayName}</Body>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={st.chipRow}>
              {TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => { setType(t); if (NO_ADDRESS.includes(t)) setValue(""); }}
                  style={[st.chip, type === t && st.chipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Type ${t}${type === t ? ", selected" : ""}`}>
                  <Body style={{ fontSize: 13, fontWeight: "600", color: type === t ? Hearth.white : Hearth.ink600 }}>{t}</Body>
                </Pressable>
              ))}
            </View>
            <TextInput style={st.input} placeholder="Label (e.g. Mobile)" placeholderTextColor={Hearth.ink400} value={label} onChangeText={setLabel} accessibilityLabel="Contact method label" />
            {NO_ADDRESS.includes(type) ? (
              <Muted style={{ fontSize: 12 }}>{type === "In-App" ? "Notifications appear in HomeOps when this profile is signed in — no address needed." : "Shown on the shared household dashboard — no address needed."}</Muted>
            ) : (
              <TextInput
                style={st.input}
                placeholder={type === "Email" ? "you@example.com" : "(555) 000-0000"}
                placeholderTextColor={Hearth.ink400}
                value={value}
                onChangeText={setValue}
                autoCapitalize="none"
                keyboardType={type === "Email" ? "email-address" : "phone-pad"}
                accessibilityLabel="Contact method address"
              />
            )}
            <Button title="Add contact method" variant="ember" loading={busy === "add"} disabled={!label.trim() || (!NO_ADDRESS.includes(type) && !value.trim())} onPress={() => void add()} />
          </Card>
        )}

        {members.map((m) => {
          const mine = byMember[m.actorId] ?? [];
          return (
            <View key={m.actorId} style={{ marginTop: 16 }}>
              <Eyebrow>{m.displayName}{m.isCurrentUser ? "  ·  You" : ""}</Eyebrow>
              {mine.length === 0 ? (
                <Card style={{ marginTop: 8 }}><Muted>No contact methods yet.</Muted></Card>
              ) : (
                mine.map((c) => (
                  <Card key={c.id} style={{ marginTop: 8 }}>
                    <View style={st.between}>
                      <View style={st.row}>
                        <Ionicons name={TYPE_ICON[c.type] ?? "notifications-outline"} size={16} color={Hearth.ink500} />
                        <View style={{ flexShrink: 1 }}>
                          <Body style={{ fontWeight: "600" }}>{c.label}</Body>
                          <Muted style={{ fontSize: 12 }}>{c.value}</Muted>
                        </View>
                      </View>
                      {c.verified
                        ? <Badge label="Verified" color={Hearth.sage600} bg={Hearth.sageBg} />
                        : <Badge label={c.optInStatus === "Pending" ? "Pending" : "Unverified"} color={Hearth.ember600} bg={Hearth.ember50} />}
                    </View>
                    <View style={st.row}>
                      <Muted style={{ fontSize: 12 }}>{c.optInStatus === "Opted In" ? "Opted in" : c.optInStatus}</Muted>
                      {c.allowedAgentIds.length > 0 && <Muted style={{ fontSize: 12 }}>· {c.allowedAgentIds.length} agent{c.allowedAgentIds.length === 1 ? "" : "s"} allowed</Muted>}
                    </View>
                    {canManage(c.memberId) && (
                      <View style={st.btnRow}>
                        {!c.verified && (
                          <View style={{ flex: 1 }}>
                            <Button title="Verify" variant="ghost" loading={busy === `v:${c.id}`} onPress={() => void startVerify(c)} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Button title="Send test" variant="ghost" loading={busy === `t:${c.id}`} onPress={() => void sendTest(c)} />
                        </View>
                        <Pressable
                          onPress={() => void remove(c)}
                          style={st.trash}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${c.label}`}>
                          {busy === `d:${c.id}` ? <Ionicons name="hourglass-outline" size={18} color={Hearth.ink400} /> : <Ionicons name="trash-outline" size={18} color={Hearth.coral600} />}
                        </Pressable>
                      </View>
                    )}
                    {codeEntryId === c.id && !c.verified && (
                      <View style={st.codeRow}>
                        <Muted style={{ fontSize: 12 }}>Enter the 6-digit code sent to {c.value}:</Muted>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 6, alignItems: "center" }}>
                          <TextInput
                            style={[st.input, st.codeInput]}
                            placeholder="000000"
                            placeholderTextColor={Hearth.ink400}
                            value={code}
                            onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                            keyboardType="number-pad"
                            maxLength={6}
                            accessibilityLabel="Verification code"
                          />
                          <View style={{ flex: 1 }}>
                            <Button title="Confirm" variant="ember" loading={busy === `c:${c.id}`} disabled={!/^\d{6}$/.test(code)} onPress={() => void confirmVerify(c)} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Button title="Cancel" variant="ghost" onPress={() => { setCodeEntryId(null); setCode(""); }} />
                          </View>
                        </View>
                      </View>
                    )}
                    {manualOfferId === c.id && !c.verified && isAdult && (
                      <View style={st.codeRow}>
                        <Muted style={{ fontSize: 12 }}>The channel can&apos;t deliver a code until it&apos;s set up in Connections. You can take responsibility and mark it verified.</Muted>
                        <View style={{ marginTop: 6 }}>
                          <Button title="Mark verified manually" variant="ghost" loading={busy === `v:${c.id}`} onPress={() => void manualVerify(c)} />
                        </View>
                      </View>
                    )}
                  </Card>
                ))
              )}
            </View>
          );
        })}
        {members.length === 0 && <Card style={{ marginTop: 16 }}><Muted>Can&apos;t load the roster — is the backend reachable?</Muted></Card>}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 },
  between: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  notice: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  input: {
    borderWidth: 1, borderColor: Hearth.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Hearth.ink900, backgroundColor: Hearth.white,
  },
  chipRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: Hearth.border, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Hearth.white },
  chipActive: { backgroundColor: Hearth.ink800, borderColor: Hearth.ink800 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  trash: { padding: 8 },
  codeRow: { marginTop: 10, borderTopWidth: 1, borderTopColor: Hearth.border, paddingTop: 10 },
  codeInput: { width: 110, textAlign: "center", letterSpacing: 6 },
});
