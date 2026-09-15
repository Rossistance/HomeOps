// Start a helper.
//
// Two doors, and they lead to the same room: a ready-made helper, or a blank one. Either way
// you land in the EDITOR with the real instructions in front of you, editable, unsaved.
//
// That last part is the whole design. The old sheet asked the planner to draft something,
// showed you a summary of it, and offered "Approve & build" — so the text that actually
// decided the helper's behaviour was the one thing you never saw. A template here is not a
// promise or a prompt; it is the instructions themselves, and nothing is created until a
// person has read them and pressed Save on the editor.
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { api, type HelperTemplate, type HelperTemplateSection } from "@/lib/api";
import { useTheme, tapHaptic } from "@/theme";
import { categoryStyle, titleCase } from "@/theme/categories";
import { T, Card, Row, SymTile, HSheet, Skeleton } from "@/components/ui";

/** What the editor needs to open pre-filled. Route params, so every value is a string. */
export interface HelperDraftParams extends Record<string, string> {
  name: string;
  purpose: string;
  instructions: string;
  autonomy: string;
  /** A HelperSchedule, JSON-encoded — expo-router params carry strings only. */
  schedule: string;
  icon: string;
}

export function NewHelperSheet({ visible, onClose, onPicked }: {
  visible: boolean;
  onClose: () => void;
  onPicked: (draft: HelperDraftParams) => void;
}) {
  const { colors, spacing } = useTheme();
  const [sections, setSections] = useState<HelperTemplateSection[] | null>(null);

  // Fetched when the sheet opens, not at mount: a screen that never opens this has no
  // business asking the server for a catalog.
  useEffect(() => {
    if (!visible || sections) return;
    let live = true;
    void api.helperTemplates().then((s) => { if (live) setSections(s); }).catch(() => { if (live) setSections([]); });
    return () => { live = false; };
  }, [visible, sections]);

  const pick = (t: HelperTemplate) => {
    tapHaptic("light");
    onPicked({
      name: t.name,
      purpose: t.purpose,
      instructions: t.instructions,
      autonomy: t.autonomy,
      schedule: JSON.stringify(t.schedule),
      icon: t.icon,
    });
  };

  const scratch = () => {
    tapHaptic("light");
    onPicked({
      name: "",
      purpose: "",
      instructions: "",
      autonomy: "ask",
      schedule: JSON.stringify({ kind: "manual" }),
      icon: "sparkle",
    });
  };

  return (
    <HSheet visible={visible} onClose={onClose} title="New helper" leftLabel="Cancel" heightPct={0.88}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <T kind="sub">
          Pick one to start from — you&apos;ll see exactly what it does and can change every word before it&apos;s saved.
        </T>

        <Card padded={false}>
          <Row
            icon="square.and.pencil"
            iconColor={colors.ember}
            iconBg={colors.emberBg}
            title="Start from scratch"
            subtitle="A blank helper. You write what it does."
            chevron
            onPress={scratch}
            last
          />
        </Card>

        {sections === null ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton height={120} />
            <Skeleton height={120} />
          </View>
        ) : sections.length === 0 ? (
          <T kind="sub">
            The ready-made helpers couldn&apos;t load just now. Start from scratch above — nothing else is missing.
          </T>
        ) : (
          sections.map((s) => {
            const look = categoryStyle(colors, s.title);
            return (
              <Card key={s.key} padded={false} style={{ overflow: "hidden" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 6 }}>
                  <SymTile name={look.icon} color={look.fg} bg={look.bg} size={30} iconSize={16} />
                  {/* The heading wears its category's colour, so the section and the cards
                      under it agree — colour as a fact, not as decoration. */}
                  <T kind="subMedium" color={look.fg} style={{ flex: 1 }}>{titleCase(s.title)}</T>
                </View>
                {s.templates.map((t, i) => (
                  <Row
                    key={t.id}
                    icon={t.icon || categoryStyle(colors, `${s.title} ${t.name}`).icon}
                    iconColor={categoryStyle(colors, `${s.title} ${t.name}`).fg}
                    iconBg={categoryStyle(colors, `${s.title} ${t.name}`).bg}
                    title={t.name}
                    /* Purpose AND schedule, because "what is it" and "how often will it
                       bother me" are one decision, and splitting them across two screens is
                       what made the old catalog a guessing game. */
                    subtitle={`${t.purpose}\n${t.scheduleText} · ${t.autonomyText}`}
                    chevron
                    onPress={() => pick(t)}
                    last={i === s.templates.length - 1}
                  />
                ))}
              </Card>
            );
          })
        )}
      </ScrollView>
    </HSheet>
  );
}
