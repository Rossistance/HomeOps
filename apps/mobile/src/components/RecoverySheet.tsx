// D1 and D2 — getting back in.
//
// From the 2026-07-25 walkthrough, at "Sign in with email":
//   [01:32] "There's no forgot password. It should send an email with a recovery code."
//   [01:46] "And a forgot email, or forgot username."
//
// Password reset is three steps on purpose: ask, enter the code, choose a new password. The
// code is confirmed BEFORE the new password is asked for — typing a password twice only to be
// told the code was wrong is a bad way to find that out.
//
// Neither flow ever reveals whether an account exists. The server answers identically either
// way, so the copy here says what WILL happen if the address is real rather than claiming
// something did. "We've sent a code" when nothing was sent is the same false-success class
// this app has been rooting out everywhere else.
import { useEffect, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { api } from "@/lib/api";
import { useTheme, tapHaptic } from "@/theme";
import { HSheet, SheetCTA, Notice, PressableScale, T } from "@/components/ui";

export type RecoveryMode = "password" | "email";

export function RecoverySheet({ visible, mode, presetEmail, onClose, onSignIn }: {
  visible: boolean;
  mode: RecoveryMode;
  presetEmail?: string;
  onClose: () => void;
  /** Called after a successful reset so the caller can prefill the sign-in form. */
  onSignIn: (email: string) => void;
}) {
  const { colors, spacing, radii, fonts } = useTheme();
  const [step, setStep] = useState<"ask" | "code" | "password" | "done">("ask");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep("ask"); setCode(""); setToken(""); setPassword(""); setConfirm("");
    setInviteCode(""); setName(""); setNote(null); setBusy(false);
    setEmail(presetEmail ?? "");
  }, [visible, mode, presetEmail]);

  const field = {
    backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous" as const,
    paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 16, color: colors.text, fontFamily: fonts.regular,
  };

  /* ---- password reset ---- */
  const requestCode = async () => {
    setBusy(true); setNote(null);
    await api.requestPasswordReset(email.trim());
    setBusy(false);
    tapHaptic("success");
    setStep("code");
    // Careful wording: the server won't say whether the account exists, so neither do we.
    setNote({ ok: true, text: "If that email has an account, a 6-digit code is on its way. It expires in 15 minutes." });
  };

  const checkCode = async () => {
    setBusy(true); setNote(null);
    const r = await api.verifyResetCode(email.trim(), code.trim());
    setBusy(false);
    if (!r.token) {
      setNote({
        ok: false,
        text: r.message ?? "That code isn't right, or it's expired.",
      });
      return;
    }
    setToken(r.token);
    setStep("password");
  };

  const setNewPassword = async () => {
    setBusy(true); setNote(null);
    const r = await api.completePasswordReset(token, password);
    setBusy(false);
    if (!r.ok) {
      setNote({ ok: false, text: r.message ?? "Couldn't set that password — try requesting a new code." });
      return;
    }
    tapHaptic("success");
    setStep("done");
  };

  /* ---- forgot which email ---- */
  const askEmail = async () => {
    setBusy(true); setNote(null);
    await api.recoverEmail(inviteCode.trim(), name.trim());
    setBusy(false);
    tapHaptic("success");
    setNote({
      ok: true,
      text: "If that matches an account, we've emailed the address to itself — check the inbox you think you used.",
    });
  };

  const title = mode === "email" ? "Which email did I use?" : "Reset your password";

  const cta = mode === "email"
    ? { label: busy ? "Sending…" : "Email it to me", disabled: !inviteCode.trim() || !name.trim() || busy, onPress: askEmail }
    : step === "ask" ? { label: busy ? "Sending…" : "Send me a code", disabled: !email.includes("@") || busy, onPress: requestCode }
    : step === "code" ? { label: busy ? "Checking…" : "Check code", disabled: code.trim().length < 6 || busy, onPress: checkCode }
    : step === "password" ? { label: busy ? "Saving…" : "Set new password", disabled: password.length < 8 || password !== confirm || busy, onPress: setNewPassword }
    : { label: "Sign in", disabled: false, onPress: () => { onSignIn(email.trim()); onClose(); } };

  return (
    <HSheet
      visible={visible}
      onClose={onClose}
      title={title}
      leftLabel="Cancel"
      heightPct={0.7}
      footer={<SheetCTA title={cta.label} disabled={cta.disabled} onPress={() => void cta.onPress()} />}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {note ? <Notice text={note.text} ok={note.ok} /> : null}

        {mode === "email" ? (
          <>
            <T kind="sub">
              We&apos;ll send your sign-in address to itself. Nothing is shown here — so if the
              inbox you check isn&apos;t yours, you learn nothing about it.
            </T>
            <View style={{ gap: 6 }}>
              <T kind="eyebrow">Your household&apos;s invite code</T>
              <TextInput
                value={inviteCode} onChangeText={setInviteCode}
                placeholder="Ask another member for it"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none" autoCorrect={false}
                style={field} accessibilityLabel="Household invite code"
              />
            </View>
            <View style={{ gap: 6 }}>
              <T kind="eyebrow">Your name, as the household has it</T>
              <TextInput
                value={name} onChangeText={setName}
                placeholder="Ross Hixon"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="words"
                style={field} accessibilityLabel="Your display name"
              />
            </View>
          </>
        ) : step === "ask" ? (
          <>
            <T kind="sub">We&apos;ll email a 6-digit code to the address on the account.</T>
            <TextInput
              value={email} onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" inputMode="email"
              style={field} accessibilityLabel="Your email"
            />
          </>
        ) : step === "code" ? (
          <>
            <T kind="sub">Enter the 6-digit code from the email.</T>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad" inputMode="numeric" autoFocus
              maxLength={6}
              style={[field, { fontSize: 26, letterSpacing: 8, textAlign: "center" }]}
              accessibilityLabel="Recovery code"
            />
            <PressableScale
              onPress={() => void requestCode()}
              haptic="select" disabled={busy}
              accessibilityRole="button" accessibilityLabel="Send another code"
              style={{ alignItems: "center", paddingVertical: spacing.sm }}
            >
              <T kind="subMedium" color={colors.ember}>Send another code</T>
            </PressableScale>
          </>
        ) : step === "password" ? (
          <>
            <T kind="sub">Code accepted. Choose a new password — at least 8 characters.</T>
            <TextInput
              value={password} onChangeText={setPassword}
              placeholder="New password"
              placeholderTextColor={colors.textFaint}
              secureTextEntry autoCapitalize="none" autoFocus
              style={field} accessibilityLabel="New password"
            />
            <TextInput
              value={confirm} onChangeText={setConfirm}
              placeholder="Type it again"
              placeholderTextColor={colors.textFaint}
              secureTextEntry autoCapitalize="none"
              style={field} accessibilityLabel="Confirm new password"
            />
            {confirm.length > 0 && password !== confirm ? (
              <T kind="sub" color={colors.coral}>Those don&apos;t match yet.</T>
            ) : null}
          </>
        ) : (
          <>
            <Notice ok text="Password changed. Every device has been signed out — sign in again with the new one." />
          </>
        )}
      </ScrollView>
    </HSheet>
  );
}
