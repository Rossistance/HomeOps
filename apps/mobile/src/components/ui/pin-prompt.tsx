// "Prove it's you" — the pause before a change that lets things run unsupervised.
//
// "The advanced mode should come with a warning saying that if you do choose to use this,
//  you risk screwing up how a helper behaves — possibly a pin input. And the same here on the
//  advanced builders: this should require a pin input."
//
// Two things happen here and both matter. The WARNING says what could go wrong in plain
// words, because a PIN box with no explanation just trains people to type their PIN. The
// PIN itself is the deliberate act — re-entered now, by whoever is holding the phone, not
// inferred from a session that was elevated twenty minutes ago in another room.
//
// The server is the authority (requireHouseholdPin in server/index.mjs). This is the polite
// front door; a household with no PIN set is not gated by one, and the server says so by
// simply not asking.
import { useState } from "react";
import { Modal, TextInput, View } from "react-native";
import { useTheme } from "@/theme";
import { Button } from "./button";
import { Card } from "./card";
import { T } from "./text";

export function PinPrompt({ visible, title, warning, busy, error, onCancel, onConfirm }: {
  visible: boolean;
  title: string;
  /** What could go wrong, said plainly. Shown above the field, never after. */
  warning: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const [pin, setPin] = useState("");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.xl }}>
        <Card style={{ gap: spacing.md }}>
          <T kind="h3">{title}</T>
          {/* The warning leads. A field first would make this a formality. */}
          <T kind="sub" color={colors.textSecondary}>{warning}</T>
          <TextInput
            value={pin}
            onChangeText={setPin}
            placeholder="Household PIN"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            keyboardType="number-pad"
            autoFocus
            accessibilityLabel="Household PIN"
            style={{
              backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous",
              paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, letterSpacing: 4, color: colors.text,
            }}
          />
          {error ? <T kind="caption" color={colors.coral}>{error}</T> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="neutral" full onPress={() => { setPin(""); onCancel(); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Continue" full
                loading={busy}
                disabled={pin.trim().length < 4}
                onPress={() => onConfirm(pin.trim())}
              />
            </View>
          </View>
        </Card>
      </View>
    </Modal>
  );
}
