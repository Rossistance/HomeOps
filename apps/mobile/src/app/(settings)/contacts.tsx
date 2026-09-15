// Contacts — the server-owned contact-method registry on mobile: each member's
// delivery addresses (email/text/in-app/dashboard) with their real verified and
// opt-in state. Everything here is enforced server-side: adults manage anyone's
// methods, everyone else manages only their own, and helpers can only message a
// method that's verified and opted-in.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { api, type ContactMethodRec, type ContactMethodType, type MemberRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, type HearthColors } from "@/theme";
import {
  Badge, Button, Card, Chip, ChipRow, ErrorState, HScreen, Notice,
  Rise, SectionHeader, SkeletonCards, SymTile, T, Well,
} from "@/components/ui";

const TYPES: ContactMethodType[] = ["Email", "Phone/Text", "In-App", "Family Dashboard"];
// In-App and Family Dashboard aren't external addresses — the server assigns their
// fixed channel value and they're born verified (nothing external to confirm).
const NO_ADDRESS: ContactMethodType[] = ["In-App", "Family Dashboard"];
const TYPE_ICON: Record<ContactMethodType, string> = {
  "Email": "envelope",
  "Phone/Text": "message",
  "In-App": "bell",
  "Family Dashboard": "tv",
};

function typeTone(c: HearthColors, t: ContactMethodType): { fg: string; bg: string } {
  switch (t) {
    case "Email": return { fg: c.sky, bg: c.skyBg };
    case "Phone/Text": return { fg: c.sage, bg: c.sageBg };
    case "In-App": return { fg: c.amber, bg: c.amberBg };
    default: return { fg: c.lavender, bg: c.lavenderBg };
  }
}

/** Six individual digit boxes backed by one hidden input (so SMS autofill works). */
function CodeBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { colors, radii } = useTheme();
  const ref = useRef<TextInput>(null);
  const active = Math.min(value.length, 5);
  return (
    <Pressable
      onPress={() => ref.current?.focus()}
      accessibilityRole="none"
      accessibilityLabel="Verification code entry"
    >
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
        {Array.from({ length: 6 }, (_, i) => {
          const focusedBox = i === active && value.length < 6;
          return (
            <View
              key={i}
              style={{
                width: 42, height: 52, borderRadius: radii.sm, borderCurve: "continuous",
                backgroundColor: colors.surface,
                borderWidth: focusedBox ? 2 : 1,
                borderColor: focusedBox ? colors.ember : colors.border,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <T kind="h2" color={colors.text}>{value[i] ?? ""}</T>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        caretHidden
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        accessibilityLabel="Verification code"
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
    </Pressable>
  );
}

export default function ContactsScreen() {
  const { session } = useSession();
  const { colors, spacing, radii, fonts } = useTheme();
  const isAdult = ["Owner", "Adult Admin", "Adult Member"].includes(session?.role ?? "");
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [methods, setMethods] = useState<ContactMethodRec[]>([]);
  const [loaded, setLoaded] = useState(false);
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
    setLoaded(true);
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
      setNotice({ text: r.contactMethod.verified ? "Contact method added." : "Contact method added — verify it before helpers can message it.", ok: true });
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
      setNotice({ text: `“${c.label}” verified — helpers can now message it.`, ok: true });
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
    const r = await api.notify({ methodId: c.id, title: "FamiliOS test", body: `This is a test notification to your “${c.label}” contact method.` });
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
  /* J2 [24:07] — "the contact methods need to be EDITABLE, not just removable." A typo in a
   * phone number meant deleting the method, re-adding it, and re-verifying from scratch.
   *
   * Editing the VALUE resets verification server-side (that's correct — a different address
   * has not proved anything), so the UI says so before the change rather than after. Editing
   * only the label leaves verification alone. */
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editValue, setEditValue] = useState("");

  const beginEdit = (c: ContactMethodRec) => {
    tapHaptic("select");
    setEditId(c.id);
    setEditLabel(c.label);
    setEditValue(c.value ?? "");
  };

  const saveEdit = async (c: ContactMethodRec) => {
    const label = editLabel.trim();
    const value = editValue.trim();
    if (!label) { setNotice({ text: "Give it a name you'll recognise.", ok: false }); return; }
    const valueChanged = value !== (c.value ?? "");
    setBusy(`e:${c.id}`);
    const r = await api.patchContactMethod(c.id, { label, ...(valueChanged ? { value } : {}) });
    setBusy(null);
    if (!r.contactMethod) {
      setNotice({ text: r.message ?? "Couldn't save that change.", ok: false });
      return;
    }
    tapHaptic("success");
    setEditId(null);
    setNotice({
      // Say what the change actually cost. A silently un-verified method that stops
      // delivering is the kind of quiet failure this app keeps hunting down.
      text: valueChanged
        ? `Saved. Because the address changed, "${label}" needs verifying again before anything can be sent to it.`
        : "Saved.",
      ok: true,
    });
    await load();
  };

  const confirmRemove = (c: ContactMethodRec) => {
    Alert.alert(`Remove “${c.label}”?`, "Helpers will no longer be able to message it.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void remove(c) },
    ]);
  };

  const statusBadge = (c: ContactMethodRec) => {
    // The server records verifiedVia:"manual" for admin overrides; surface it when present.
    const via = (c as ContactMethodRec & { verifiedVia?: string }).verifiedVia;
    if (c.verified) {
      return via === "manual"
        ? <Badge label="Verified · manual" fg={colors.lavender} bg={colors.lavenderBg} icon="checkmark.seal" />
        : <Badge label="Verified" fg={colors.sage} bg={colors.sageBg} icon="checkmark.seal.fill" />;
    }
    return <Badge label={c.optInStatus === "Pending" ? "Pending" : "Unverified"} fg={colors.amber} bg={colors.amberBg} icon="clock" />;
  };

  const selectedMember = forMember ?? session?.actorId ?? null;
  const inputStyle = {
    backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous" as const,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    color: colors.text, fontFamily: fonts.regular, fontSize: 15,
  };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh} keyboardAware>
      <Rise index={0} style={{ gap: spacing.sm }}>
        <T kind="sub">How the family gets reached. Helpers can only message a method that's verified and opted-in.</T>
        {!isAdult ? <T kind="caption" color={colors.textFaint}>You can manage your own methods; changing someone else's needs an adult.</T> : null}
        <Button
          title={composerOpen ? "Close" : "Add contact method"}
          variant={composerOpen ? "neutral" : "ember"}
          icon={composerOpen ? "xmark" : "plus"}
          full
          onPress={() => setComposerOpen((v) => !v)}
        />
      </Rise>

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {composerOpen ? (
        <Rise index={1}>
          <Card style={{ gap: spacing.md }}>
            {addableMembers.length > 1 ? (
              <View style={{ gap: 6 }}>
                <T kind="eyebrow">For</T>
                <ChipRow>
                  {addableMembers.map((m) => (
                    <Chip key={m.actorId} label={m.displayName} selected={selectedMember === m.actorId} onPress={() => setForMember(m.actorId)} />
                  ))}
                </ChipRow>
              </View>
            ) : null}
            <View style={{ gap: 6 }}>
              <T kind="eyebrow">Type</T>
              <ChipRow>
                {TYPES.map((t) => (
                  <Chip key={t} label={t} icon={TYPE_ICON[t]} selected={type === t} onPress={() => { setType(t); if (NO_ADDRESS.includes(t)) setValue(""); }} />
                ))}
              </ChipRow>
            </View>
            <TextInput
              style={inputStyle}
              placeholder="Label (e.g. Mobile)"
              placeholderTextColor={colors.textFaint}
              value={label}
              onChangeText={setLabel}
              accessibilityLabel="Contact method label"
            />
            {NO_ADDRESS.includes(type) ? (
              <Well>
                <T kind="sub">
                  {type === "In-App"
                    ? "Notifications appear in FamiliOS when this profile is signed in — no address needed."
                    : "Shown on the shared household dashboard — no address needed."}
                </T>
              </Well>
            ) : (
              <TextInput
                style={inputStyle}
                placeholder={type === "Email" ? "you@example.com" : "(555) 000-0000"}
                placeholderTextColor={colors.textFaint}
                value={value}
                onChangeText={setValue}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={type === "Email" ? "email-address" : "phone-pad"}
                accessibilityLabel="Contact method address"
              />
            )}
            <Button
              title="Add method"
              variant="ember"
              full
              loading={busy === "add"}
              disabled={!label.trim() || (!NO_ADDRESS.includes(type) && !value.trim())}
              onPress={() => void add()}
            />
          </Card>
        </Rise>
      ) : null}

      {!loaded ? (
        <SkeletonCards count={3} />
      ) : members.length === 0 ? (
        <ErrorState message="Can't load the roster — is the backend reachable?" onRetry={() => void load()} />
      ) : (
        members.map((m, mi) => {
          const mine = byMember[m.actorId] ?? [];
          return (
            <View key={m.actorId}>
              <SectionHeader title={`${m.displayName}${m.isCurrentUser ? "  ·  You" : ""}`} />
              {mine.length === 0 ? (
                <Rise index={Math.min(mi + 2, 8)}>
                  <Card><T kind="sub">No contact methods yet.</T></Card>
                </Rise>
              ) : (
                <Rise index={Math.min(mi + 2, 8)}>
                  <Card padded={false}>
                    {mine.map((c, ci) => {
                      const tn = typeTone(colors, c.type);
                      return (
                        <View
                          key={c.id}
                          style={{
                            padding: spacing.lg, gap: 10,
                            borderBottomWidth: ci === mine.length - 1 ? 0 : 1,
                            borderBottomColor: colors.border,
                          }}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                            <SymTile name={TYPE_ICON[c.type] ?? "bell"} color={tn.fg} bg={tn.bg} />
                            <View style={{ flex: 1, gap: 2 }}>
                              <T kind="bodyMedium" color={colors.text}>{c.label}</T>
                              <T kind="sub" numberOfLines={1}>
                                {c.value ? `${c.value} · ` : ""}{c.optInStatus === "Opted In" ? "Opted in" : c.optInStatus}
                                {c.allowedAgentIds.length > 0 ? ` · ${c.allowedAgentIds.length} helper${c.allowedAgentIds.length === 1 ? "" : "s"} allowed` : ""}
                              </T>
                            </View>
                            {statusBadge(c)}
                          </View>

                          {canManage(c.memberId) ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                              {!c.verified ? (
                                <Button title="Verify" variant="neutral" small loading={busy === `v:${c.id}`} onPress={() => void startVerify(c)} />
                              ) : null}
                              <Button title="Send test" variant="ghost" small icon="paperplane" loading={busy === `t:${c.id}`} onPress={() => void sendTest(c)} />
                              {/* J2 — editable, not only removable. */}
                              <Button title="Edit" variant="ghost" small icon="pencil" onPress={() => (editId === c.id ? setEditId(null) : beginEdit(c))} />
                              <View style={{ flex: 1 }} />
                              <Button title="Remove" variant="ghost" small icon="trash" loading={busy === `d:${c.id}`} onPress={() => confirmRemove(c)} />
                            </View>
                          ) : null}

                          {editId === c.id ? (
                            <Well style={{ gap: spacing.sm }}>
                              <View style={{ gap: 6 }}>
                                <T kind="eyebrow">Name</T>
                                <TextInput
                                  value={editLabel}
                                  onChangeText={setEditLabel}
                                  placeholder="Mum's mobile"
                                  placeholderTextColor={colors.textFaint}
                                  accessibilityLabel="Contact method name"
                                  style={inputStyle}
                                />
                              </View>
                              {c.type === "Email" || c.type === "Phone/Text" ? (
                                <View style={{ gap: 6 }}>
                                  <T kind="eyebrow">{c.type === "Email" ? "Email address" : "Phone number"}</T>
                                  <TextInput
                                    value={editValue}
                                    onChangeText={setEditValue}
                                    placeholder={c.type === "Email" ? "them@example.com" : "+1 555 0100"}
                                    placeholderTextColor={colors.textFaint}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType={c.type === "Email" ? "email-address" : "phone-pad"}
                                    accessibilityLabel={c.type === "Email" ? "Email address" : "Phone number"}
                                    style={inputStyle}
                                  />
                                  {c.verified && editValue.trim() !== (c.value ?? "") ? (
                                    <T kind="caption" color={colors.amber}>
                                      Changing the address means verifying it again — a new address hasn&apos;t proved anything yet.
                                    </T>
                                  ) : null}
                                </View>
                              ) : null}
                              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                                <View style={{ flex: 1 }}>
                                  <Button
                                    title="Save" variant="ember" small full
                                    loading={busy === `e:${c.id}`}
                                    disabled={!editLabel.trim()}
                                    onPress={() => void saveEdit(c)}
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Button title="Cancel" variant="ghost" small full onPress={() => setEditId(null)} />
                                </View>
                              </View>
                            </Well>
                          ) : null}

                          {codeEntryId === c.id && !c.verified ? (
                            <Well style={{ gap: spacing.md }}>
                              <T kind="sub" center>Enter the 6-digit code sent to {c.value || "this method"}:</T>
                              <CodeBoxes value={code} onChange={setCode} />
                              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                                <View style={{ flex: 1 }}>
                                  <Button title="Confirm" variant="ember" small full loading={busy === `c:${c.id}`} disabled={!/^\d{6}$/.test(code)} onPress={() => void confirmVerify(c)} />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Button title="Cancel" variant="ghost" small full onPress={() => { setCodeEntryId(null); setCode(""); }} />
                                </View>
                              </View>
                            </Well>
                          ) : null}

                          {manualOfferId === c.id && !c.verified && isAdult ? (
                            <Well style={{ gap: spacing.sm }}>
                              <T kind="sub">
                                The channel can't deliver a code until it's set up in Connections. You can take responsibility and mark it verified.
                              </T>
                              <Button title="Mark verified manually" variant="neutral" small loading={busy === `v:${c.id}`} onPress={() => void manualVerify(c)} />
                            </Well>
                          ) : null}
                        </View>
                      );
                    })}
                  </Card>
                </Rise>
              )}
            </View>
          );
        })
      )}
    </HScreen>
  );
}
