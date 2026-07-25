// New-agent sheet (2 steps). Step 1: describe it in a sentence (or start from a
// template); Famili's real planner drafts the agent. Step 2: review the draft,
// then create it for real via buildFromChat. AI-first: no local agent templates
// are created behind the planner's back.
import { useEffect, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { api, type AgentTemplateSectionRec, type ChatBuild } from "@/lib/api";
import { useTheme, tapHaptic } from "@/theme";
import {
  T, Badge, Well, Row, SymTile, PressableScale, HSheet, SheetCTA, Notice, useConfirmFlash,
} from "@/components/ui";

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
  const [sections, setSections] = useState<AgentTemplateSectionRec[]>([]);
  const [section, setSection] = useState("__all");

  // Loaded when the sheet opens rather than at mount — the catalog is static, but a screen
  // that never opens this sheet has no business fetching it.
  useEffect(() => {
    if (!visible || sections.length) return;
    let live = true;
    void api.agentTemplates().then((s) => { if (live) setSections(s); }).catch(() => null);
    return () => { live = false; };
  }, [visible, sections.length]);

  const visibleSections = section === "__all" ? sections : sections.filter((s) => s.key === section);

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
              {/* G6 — [19:18] "there's only four templates in the mobile app, the web app has
                  a lot more… all need to be brought over, grouped into sections so I can
                  navigate them quickly." The list is the SERVER's now, and the section chips
                  are the quick navigation: tap one and only that group is listed. */}
              <T kind="eyebrow">Or start from a template</T>
              {sections.length === 0 ? (
                <T kind="sub">Templates couldn't load just now — describe it above instead.</T>
              ) : (
                <>
                  <ScrollView
                    horizontal showsHorizontalScrollIndicator={false}
                    style={{ marginHorizontal: -spacing.xl, flexGrow: 0 }}
                    contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: 8 }}
                    keyboardShouldPersistTaps="handled"
                  >
                    {[{ key: "__all", title: "All" }, ...sections].map((s) => {
                      const active = section === s.key;
                      return (
                        <PressableScale
                          key={s.key}
                          haptic="select"
                          onPress={() => setSection(s.key)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={s.title}
                          style={{
                            paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999,
                            backgroundColor: active ? colors.ember : colors.surfaceSunken,
                          }}
                        >
                          <T kind="subMedium" color={active ? colors.onEmber : colors.textSecondary}>{s.title}</T>
                        </PressableScale>
                      );
                    })}
                  </ScrollView>
                  {visibleSections.map((s) => (
                    <View key={s.key} style={{ gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, paddingBottom: 4 }}>
                        <T kind="eyebrow">{s.title}</T>
                        {s.blurb ? <T kind="caption" color={colors.textFaint} style={{ flex: 1 }}>{s.blurb}</T> : null}
                      </View>
                      {s.templates.map((t, i) => (
                        <Row
                          key={t.id}
                          icon={t.icon}
                          iconColor={colors.ember}
                          iconBg={colors.emberBg}
                          title={t.name}
                          subtitle={t.desc}
                          chevron
                          onPress={() => { tapHaptic("light"); setText(t.prompt); }}
                          last={i === s.templates.length - 1}
                        />
                      ))}
                    </View>
                  ))}
                </>
              )}
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
