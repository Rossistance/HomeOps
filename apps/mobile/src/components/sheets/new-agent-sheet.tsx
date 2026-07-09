// New-agent sheet (2 steps). Step 1: describe it in a sentence (or start from a
// template); Famili's real planner drafts the agent. Step 2: review the draft,
// then create it for real via buildFromChat. AI-first: no local agent templates
// are created behind the planner's back.
import { useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { api, type ChatBuild } from "@/lib/api";
import { useTheme } from "@/theme";
import {
  T, Badge, Well, Row, SymTile, PressableScale, HSheet, SheetCTA, Notice, useConfirmFlash,
} from "@/components/ui";

const TEMPLATES = [
  { name: "Homework Helper", icon: "graduationcap", desc: "Assignments tracked, kids nudged before due dates", prompt: "Create a Homework Helper agent that tracks the kids' assignments and reminds them on school nights at 6pm." },
  { name: "Carpool Coordinator", icon: "person.2", desc: "Pickup rotations confirmed with your approval", prompt: "Create a Carpool Coordinator agent that reads practice times from the calendar and drafts pickup confirmations for my approval." },
  { name: "Travel Prep", icon: "folder", desc: "Packing lists and documents before each trip", prompt: "Create a Travel Prep agent that spots trips on the calendar, builds packing lists, and checks document renewal dates two weeks before each trip." },
  { name: "Plant & Yard", icon: "sun.max", desc: "Seasonal watering and yard reminders", prompt: "Create a Plant & Yard agent that sends weekly watering and yard reminders, adjusted to the weather." },
] as const;

export function NewAgentSheet({ visible, onClose, onCreated }: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { colors, spacing } = useTheme();
  const { flash, show } = useConfirmFlash();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [build, setBuild] = useState<ChatBuild | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  function reset() {
    setText(""); setBusy(false); setNote(null); setBuild(null); setConversationId(undefined);
  }
  function close() { reset(); onClose(); }

  async function draft() {
    if (!text.trim() || busy) return;
    setBusy(true); setNote(null);
    const conv = await api.createConversation(`New agent: ${text.trim().slice(0, 40)}`);
    setConversationId(conv?.id);
    const r = await api.assistant(`Create an agent: ${text.trim()}`, { conversationId: conv?.id });
    setBusy(false);
    if (!r.ok) { setNote(r.message ?? "Famili couldn't draft that right now — try again."); return; }
    if (r.kind === "build" && r.build?.agent) { setBuild(r.build); return; }
    setNote(r.answer ?? "Famili answered without drafting an agent — try describing the job more concretely.");
  }

  async function create() {
    if (!build || busy) return;
    setBusy(true); setNote(null);
    const r = await api.buildFromChat(build, conversationId);
    setBusy(false);
    if (!r.ok) {
      const msg = r.error === "insufficient_role" ? "Only household admins can create agents." : r.message ?? "Couldn't create the agent — try again.";
      Alert.alert("Not created", msg);
      return;
    }
    show("agent", () => { onCreated(); close(); });
  }

  const steps = build?.skill?.steps ?? [];

  return (
    <>
      <HSheet
        visible={visible} onClose={close} title="New agent" leftLabel="Cancel" heightPct={0.88}
        footer={build
          ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <PressableScale onPress={() => setBuild(null)} style={{ flex: 1, height: 52, borderRadius: 15, borderCurve: "continuous", backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
                <T kind="bodyMedium" color={colors.textSecondary} style={{ fontWeight: "600" }}>Back</T>
              </PressableScale>
              <View style={{ flex: 1.6 }}>
                <SheetCTA title={busy ? "Creating…" : "Create agent"} onPress={() => void create()} disabled={busy} />
              </View>
            </View>
          )
          : <SheetCTA title={busy ? "Drafting…" : "Draft agent"} onPress={() => void draft()} disabled={!text.trim() || busy} />}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
          {!build ? (
            <>
              <T kind="h2">What do you need help with?</T>
              <Well style={{ padding: 0 }}>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  multiline
                  placeholder="e.g. Remind us to water the plants weekly"
                  placeholderTextColor={colors.textFaint}
                  style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text, minHeight: 88, textAlignVertical: "top" }}
                />
              </Well>
              <T kind="detail">Describe it in a sentence — Famili drafts the agent for your review.</T>
              {note && <Notice text={note} ok={false} />}
              <T kind="eyebrow">Or start from a template</T>
              <View style={{ gap: 2 }}>
                {TEMPLATES.map((t, i) => (
                  <Row
                    key={t.name}
                    icon={t.icon}
                    iconColor={colors.ember}
                    iconBg={colors.emberBg}
                    title={t.name}
                    subtitle={t.desc}
                    chevron
                    onPress={() => setText(t.prompt)}
                    last={i === TEMPLATES.length - 1}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile name="cpu" color={colors.sky} bg={colors.skyBg} size={44} iconSize={20} />
                <View style={{ flex: 1 }}>
                  <T kind="h2Serif">{build.agent?.name ?? "New agent"}</T>
                </View>
                <Badge label="Draft" fg={colors.sky} bg={colors.skyBg} />
              </View>
              {!!build.agent?.purpose && <T kind="body">{build.agent.purpose}</T>}
              {!!build.summary && !build.agent?.purpose && <T kind="body">{build.summary}</T>}
              {steps.length > 0 && (
                <View style={{ gap: spacing.sm }}>
                  <T kind="eyebrow">How it will work</T>
                  {steps.map((s, i) => (
                    <View key={i} style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}>
                        <T kind="caption" color={colors.ember}>{i + 1}</T>
                      </View>
                      <View style={{ flex: 1 }}>
                        <T kind="sub" color={colors.textSecondary}>{s.name}</T>
                        {s.approval_required && <T kind="detail" color={colors.amber}>Needs your approval</T>}
                      </View>
                    </View>
                  ))}
                </View>
              )}
              <Well>
                <T kind="detail">Starts as a draft — nothing runs until you activate it, and anything leaving the household still needs your approval.</T>
              </Well>
            </>
          )}
        </ScrollView>
      </HSheet>
      {flash}
    </>
  );
}
