// G1 — a helper you can actually change.
//
// From the 2026-07-25 walkthrough at the agent detail screen [17:48]: "There's not really
// anything I can do here except run it, pause it, and blank space. I should be able to change
// the name of the agent, edit what it does."
//
// So: name, what it's for, and the instructions it actually follows — the last one being the
// thing that decides its behaviour, and until now visible only as four sentences chopped out
// of it under "How this agent works".
//
// Keyboard rule (Theme C, six separate sightings): the control that commits the edit must
// never be the thing the keyboard covers. Save lives in the sheet footer above the keyboard
// inset, and the focused field scrolls itself into view.
import { useEffect, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { useTheme } from "@/theme";
import { HSheet, SheetCTA, T } from "@/components/ui";
import type { AgentRec } from "@/lib/api";

export interface AgentEdits { name: string; purpose: string; instructions: string }

function Field({ label, hint, value, onChangeText, multiline, minHeight, autoFocus, onFocus }: {
  label: string; hint?: string; value: string; onChangeText: (t: string) => void;
  multiline?: boolean; minHeight?: number; autoFocus?: boolean; onFocus?: () => void;
}) {
  const { colors, spacing, radii, type } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T kind="eyebrow">{label}</T>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        multiline={multiline}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        placeholder={hint}
        placeholderTextColor={colors.textFaint}
        style={{
          backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous",
          paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
          minHeight: minHeight ?? 46, textAlignVertical: multiline ? "top" : "center",
          ...type.body, color: colors.text,
        }}
      />
      {hint ? <T kind="caption" color={colors.textFaint}>{hint}</T> : null}
      <View style={{ height: spacing.xs }} />
    </View>
  );
}

export function AgentEditSheet({ visible, agent, onClose, onSave, saving }: {
  visible: boolean;
  agent: AgentRec | null;
  onClose: () => void;
  onSave: (edits: AgentEdits) => void;
  saving?: boolean;
}) {
  const { spacing } = useTheme();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [instructions, setInstructions] = useState("");
  const scroller = useRef<ScrollView>(null);

  // Re-seed each time it opens so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!visible || !agent) return;
    setName(agent.name ?? "");
    setPurpose(agent.purpose ?? "");
    setInstructions(agent.instructions ?? "");
  }, [visible, agent]);

  const dirty = !!agent && (name.trim() !== (agent.name ?? "") || purpose !== (agent.purpose ?? "") || instructions !== (agent.instructions ?? ""));

  return (
    <HSheet
      visible={visible}
      onClose={onClose}
      title="Edit helper"
      leftLabel="Cancel"
      footer={
        <SheetCTA
          title={saving ? "Saving…" : "Save changes"}
          disabled={!dirty || !name.trim() || !!saving}
          onPress={() => onSave({ name: name.trim(), purpose, instructions })}
        />
      }
    >
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <Field label="Name" value={name} onChangeText={setName} autoFocus />
        <Field
          label="What it's for"
          hint="One line the family will read on its card."
          value={purpose} onChangeText={setPurpose} multiline minHeight={72}
        />
        <Field
          label="Instructions"
          hint="What it should actually do, in your words. This is what it follows when it runs."
          value={instructions} onChangeText={setInstructions} multiline minHeight={190}
          // The tallest field sits at the bottom, so focusing it is exactly the case that used
          // to hide the commit control. Scroll it up rather than trusting the inset alone.
          onFocus={() => setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 120)}
        />
      </ScrollView>
    </HSheet>
  );
}
