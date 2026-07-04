import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type AgentPlan, type ChatBuild, type ConversationRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRun } from "@/lib/run-context";
import { Badge, Body, Button, Card, Eyebrow, Muted, Screen } from "@/components/ui";
import { Hearth, riskColor } from "@/constants/hearth";

interface Msg { id: string; role: "user" | "assistant"; text: string; plan?: AgentPlan; build?: ChatBuild; built?: boolean; error?: boolean }

interface Suggestion { text: string; icon: keyof typeof Ionicons.glyphMap }

export default function AssistantScreen() {
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  // Server-durable thread: created on the first send, so both turns persist and the
  // same conversation shows up on the web. Opening a recent chat resumes its id.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [recent, setRecent] = useState<ConversationRec[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const scroller = useRef<ScrollView>(null);
  const { startRun, activeRun } = useRun();
  const { session } = useSession();
  const canBuild = session?.role === "Owner" || session?.role === "Adult Admin";

  const loadHome = useCallback(async () => {
    const [convs, approvals, events, tasks] = await Promise.all([
      api.conversations(), api.approvals(), api.events(), api.tasks(),
    ]);
    setRecent(convs.slice(0, 6));
    // Personalized, signal-based suggestions (mirror of the web's suggestAskPrompts):
    // built from what's actually going on in THIS household right now, role-aware.
    const out: Suggestion[] = [];
    const pending = approvals.filter((a) => a.status === "pending").length;
    if (pending > 0 && canBuild) out.push({ text: pending === 1 ? "What's waiting on my approval?" : `Summarize the ${pending} approvals waiting on me`, icon: "shield-checkmark-outline" });
    const today = new Date().toISOString().slice(0, 10);
    const todays = events.filter((e) => (e.startAt ?? "").startsWith(today)).length;
    if (todays > 0) out.push({ text: "What does the family's day look like?", icon: "calendar-outline" });
    const overdue = tasks.filter((t) => t.status !== "done" && t.dueAt && t.dueAt < new Date().toISOString()).length;
    if (overdue > 0) out.push({ text: `Help me knock out my ${overdue} overdue task${overdue === 1 ? "" : "s"}`, icon: "checkbox-outline" });
    if (out.length < 3) out.push({ text: "Plan this week's meals and build a grocery list", icon: "restaurant-outline" });
    if (out.length < 3) out.push({ text: "Set up a helper that triages our family inbox", icon: "mail-open-outline" });
    if (out.length < 4) out.push({ text: "What can you do for our household?", icon: "sparkles-outline" });
    setSuggestions(out.slice(0, 4));
  }, [canBuild]);

  useEffect(() => { if (session) void loadHome(); }, [session, loadHome]);

  const openConversation = async (id: string) => {
    const c = await api.conversation(id);
    if (!c) return;
    setConversationId(c.id);
    setMsgs(c.messages.map((m, i) => ({
      id: `${c.id}-${i}`, role: m.role, text: m.text,
      plan: m.plan ?? undefined, build: m.build ?? undefined, built: !!m.built,
    })));
    setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 80);
  };

  const dismissConversation = async (id: string) => {
    setRecent((r) => r.filter((c) => c.id !== id)); // optimistic
    const r = await api.deleteConversation(id);
    if (r.error) void loadHome(); // restore on failure
  };

  const send = async (preset?: string) => {
    const t = (preset ?? text).trim();
    if (!t || busy) return;
    const uid = String(Date.now());
    setText("");
    setMsgs((m) => [...m, { id: uid, role: "user", text: t }]);
    setBusy(true);
    // First turn creates the durable server thread; subsequent turns reuse it.
    let convId = conversationId;
    if (!convId) {
      const c = await api.createConversation(t.slice(0, 60));
      if (c) { convId = c.id; setConversationId(c.id); }
    }
    const r = await api.assistant(t, { conversationId: convId ?? undefined });
    setBusy(false);
    setMsgs((m) => [...m, r.ok
      ? (r.kind === "plan" && r.plan
        ? { id: uid + "a", role: "assistant", text: r.answer || r.plan.summary || "Here's my plan.", plan: r.plan }
        : r.kind === "build" && r.build
          ? { id: uid + "a", role: "assistant", text: r.answer || r.build.summary || "Here's what I'll set up.", build: r.build }
          : { id: uid + "a", role: "assistant", text: r.answer || "I'm not sure how to help with that yet." })
      : { id: uid + "a", role: "assistant", error: true, text: r.error === "no_provider"
          ? "I need an AI provider connected (Settings → AI Providers), then ask me again."
          : (r.message || "I couldn't reach the AI provider just now.") }]);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
  };

  const runBuild = async (msgId: string, build: ChatBuild) => {
    setBuildingId(msgId);
    // conversationId travels so the built state + confirmation persist server-side.
    const res = await api.buildFromChat(build, conversationId ?? undefined);
    setBuildingId(null);
    if (res.ok) {
      const cr = res.created ?? {};
      const parts = [cr.skill && `skill “${cr.skill.name}”`, cr.agent && `helper “${cr.agent.name}”`, cr.automation && `automation “${cr.automation.name}”`, ...(res.updated ?? []).filter((u) => u.ok).map((u) => `updated ${u.kind}`)].filter(Boolean);
      setMsgs((m) => m.map((x) => x.id === msgId ? { ...x, built: true } : x).concat({ id: msgId + "done", role: "assistant", text: `Done — I set up ${parts.join(", ")}.${(res.notes?.length) ? "\n\n" + res.notes.map((n) => `• ${n}`).join("\n") : ""}` }));
    } else {
      setMsgs((m) => m.concat({ id: msgId + "err", role: "assistant", error: true, text: res.error === "insufficient_role" ? "Only an Owner or Adult Admin can build helpers." : (res.message || "Couldn't build that.") }));
    }
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
  };

  const runPlan = async (plan: AgentPlan) => {
    router.push("/activity");
    await startRun(plan);
  };

  const newChat = () => { setConversationId(null); setMsgs([]); void loadHome(); };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scroller} contentContainerStyle={st.content}>
          {msgs.length === 0 ? (
            <View>
              <View style={st.empty}>
                <View style={st.mark}><Ionicons name="sparkles" size={26} color={Hearth.white} /></View>
                <Text style={st.title}>Ask HomeOps</Text>
                <Muted style={{ textAlign: "center", marginTop: 6 }}>Tell me what you need. I'll answer, or draft a plan you can approve.</Muted>
                {activeRun && (
                  <Pressable onPress={() => router.push("/activity")} style={st.activeRunBanner}>
                    <Ionicons name="pulse-outline" size={14} color={Hearth.ember600} />
                    <Text style={st.activeRunText}>Run in progress — tap to view</Text>
                  </Pressable>
                )}
              </View>
              {suggestions.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Eyebrow>For you right now</Eyebrow>
                  <View style={st.suggestWrap}>
                    {suggestions.map((s) => (
                      <Pressable key={s.text} style={st.suggestChip} onPress={() => void send(s.text)} accessibilityRole="button">
                        <Ionicons name={s.icon} size={14} color={Hearth.ember600} />
                        <Text style={st.suggestText}>{s.text}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              {recent.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Eyebrow>Recent chats</Eyebrow>
                  <Card style={{ marginTop: 8, padding: 0 }}>
                    {recent.map((c, i) => (
                      <View key={c.id} style={[st.recentRow, i > 0 && st.recentDivider]}>
                        <Pressable style={st.recentMain} onPress={() => void openConversation(c.id)} accessibilityRole="button" accessibilityLabel={`Open chat: ${c.title}`}>
                          <Ionicons name="chatbubble-ellipses-outline" size={16} color={Hearth.ink500} />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text numberOfLines={1} style={{ fontSize: 15, color: Hearth.ink800, fontWeight: "600" }}>{c.title}</Text>
                            <Muted style={{ fontSize: 12 }}>{c.messages.length} message{c.messages.length === 1 ? "" : "s"}</Muted>
                          </View>
                        </Pressable>
                        <Pressable onPress={() => void dismissConversation(c.id)} hitSlop={8} style={st.recentDismiss} accessibilityRole="button" accessibilityLabel={`Dismiss chat: ${c.title}`}>
                          <Ionicons name="close" size={16} color={Hearth.ink400} />
                        </Pressable>
                      </View>
                    ))}
                  </Card>
                </View>
              )}
            </View>
          ) : (
            <Pressable onPress={newChat} style={st.newChatBtn} accessibilityRole="button" accessibilityLabel="Start a new chat">
              <Ionicons name="add" size={14} color={Hearth.ink600} />
              <Text style={st.newChatText}>New chat</Text>
            </Pressable>
          )}
          {msgs.map((m) => m.role === "user" ? (
            <View key={m.id} style={st.userWrap}><View style={st.userBubble}><Text style={st.userText}>{m.text}</Text></View></View>
          ) : (
            <View key={m.id} style={st.aiWrap}>
              <View style={st.aiMark}><Ionicons name="sparkles" size={14} color={Hearth.white} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[st.aiText, m.error && { color: Hearth.coral600 }]}>{m.text}</Text>
                {m.plan && <PlanCard plan={m.plan} onRun={() => runPlan(m.plan!)} />}
                {m.build && <BuildCard build={m.build} built={!!m.built} busy={buildingId === m.id} canBuild={canBuild} onBuild={() => runBuild(m.id, m.build!)} />}
              </View>
            </View>
          ))}
          {busy && (
            <View style={st.aiWrap}>
              <View style={st.aiMark}><Ionicons name="sparkles" size={14} color={Hearth.white} /></View>
              <Muted>Thinking…</Muted>
            </View>
          )}
        </ScrollView>
        <View style={st.composer}>
          <TextInput value={text} onChangeText={setText} placeholder="Ask HomeOps…" placeholderTextColor={Hearth.ink400} style={st.input} multiline />
          <Pressable onPress={() => void send()} disabled={!text.trim() || busy} style={[st.sendBtn, { opacity: !text.trim() || busy ? 0.5 : 1 }]}>
            <Ionicons name="arrow-up" size={20} color={Hearth.ink900} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function PlanCard({ plan, onRun }: { plan: AgentPlan; onRun: () => void }) {
  return (
    <Card style={{ marginTop: 10 }}>
      <View style={st.between}>
        <Text style={st.planTitle}>{plan.title}</Text>
        <Badge label={`${plan.risk} risk`} color={riskColor(plan.risk)} bg={Hearth.surfaceSunken} />
      </View>
      <Muted style={{ marginTop: 2 }}>{plan.steps.length} step{plan.steps.length === 1 ? "" : "s"} · {plan.triggerType}</Muted>
      <View style={{ marginTop: 8, gap: 6 }}>
        {plan.steps.map((s, i) => (
          <View key={i} style={st.step}>
            <Text style={st.stepNum}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 14, fontWeight: "600" }}>{s.title}</Body>
              {s.detail ? <Muted style={{ fontSize: 12 }}>{s.detail}</Muted> : null}
              <View style={st.tagRow}>
                {s.connectorName ? <Badge label={s.connected ? s.connectorName : `${s.connectorName} · connect`} color={s.connected ? Hearth.sage600 : Hearth.amber600} bg={s.connected ? Hearth.sageBg : Hearth.amberBg} /> : null}
                {s.requiresApproval ? <Badge label="approval" color={Hearth.coral600} bg={Hearth.coralBg} /> : null}
              </View>
            </View>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 12 }}>
        <Button title="Run this plan" variant="ember" onPress={onRun} />
      </View>
      {plan.approvalRequired ? <Muted style={{ marginTop: 8 }}>Risky steps will pause for your approval in the Activity tab.</Muted> : null}
    </Card>
  );
}

function BuildCard({ build, built, busy, canBuild, onBuild }: { build: ChatBuild; built: boolean; busy: boolean; canBuild: boolean; onBuild: () => void }) {
  const editOnly = !build.skill && !build.agent && !build.automation && (build.edits ?? []).length > 0;
  const Row = ({ icon, label, sub }: { icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string }) => (
    <View style={st.step}>
      <Ionicons name={icon} size={16} color={Hearth.ink500} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Body style={{ fontSize: 14, fontWeight: "600" }}>{label}</Body>
        {sub ? <Muted style={{ fontSize: 12 }}>{sub}</Muted> : null}
      </View>
    </View>
  );
  return (
    <Card style={{ marginTop: 10 }}>
      <Text style={st.planTitle}>{built ? "Built" : editOnly ? "I'll update this" : "I'll set this up"}</Text>
      <Muted style={{ marginTop: 2 }}>{build.summary}</Muted>
      <View style={{ marginTop: 8, gap: 6 }}>
        {build.skill ? <Row icon="list-outline" label={`Skill · ${build.skill.name}`} sub={build.skill.description || (build.skill.steps?.length ? `${build.skill.steps.length} step${build.skill.steps.length === 1 ? "" : "s"}` : undefined)} /> : null}
        {build.agent ? <Row icon="hardware-chip-outline" label={`Helper · ${build.agent.name}`} sub={build.agent.purpose} /> : null}
        {build.automation ? <Row icon="time-outline" label={`Automation · ${build.automation.name}`} sub={build.automation.type} /> : null}
        {(build.edits ?? []).map((e, i) => <Row key={i} icon="create-outline" label={`Update ${e.kind} · ${e.id}`} sub={e.summary} />)}
      </View>
      {built ? (
        <Muted style={{ marginTop: 10, color: Hearth.sage600 }}>✓ Done — your new helper is live with its tools preselected. Find it under Helper Agents.</Muted>
      ) : !canBuild ? (
        <Muted style={{ marginTop: 10 }}>Only an Owner or Adult Admin can build helpers.</Muted>
      ) : (
        <View style={{ marginTop: 12 }}>
          <Button title={busy ? (editOnly ? "Applying…" : "Building…") : (editOnly ? "Approve & apply" : "Approve & build")} variant="ember" onPress={onBuild} disabled={busy} />
          <Muted style={{ marginTop: 8, fontSize: 12 }}>{editOnly ? "Changes are versioned and reversible." : "Creates a draft — gated steps still ask for approval."}</Muted>
        </View>
      )}
    </Card>
  );
}

const st = StyleSheet.create({
  content: { padding: 16, paddingBottom: 20, flexGrow: 1 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 32 },
  mark: { width: 56, height: 56, borderRadius: 18, backgroundColor: Hearth.ember500, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { fontSize: 24, fontWeight: "700", color: Hearth.ink900 },
  activeRunBanner: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, backgroundColor: Hearth.ember50, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: Hearth.ember400 + "44" },
  activeRunText: { fontSize: 13, color: Hearth.ember600, fontWeight: "600" },
  suggestWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  suggestChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Hearth.ember50, borderWidth: 1, borderColor: Hearth.ember400 + "33", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  suggestText: { fontSize: 13, color: Hearth.ink800, fontWeight: "500", flexShrink: 1 },
  recentRow: { flexDirection: "row", alignItems: "center" },
  recentDivider: { borderTopWidth: 1, borderTopColor: Hearth.border },
  recentMain: { flexDirection: "row", alignItems: "center", flex: 1, paddingHorizontal: 14, paddingVertical: 11 },
  recentDismiss: { padding: 10, marginRight: 4 },
  newChatBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: Hearth.rim, borderWidth: 1, borderColor: Hearth.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  newChatText: { fontSize: 12, fontWeight: "600", color: Hearth.ink600 },
  userWrap: { alignItems: "flex-end", marginVertical: 6 },
  userBubble: { backgroundColor: Hearth.ink800, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "86%" },
  userText: { color: Hearth.white, fontSize: 15 },
  aiWrap: { flexDirection: "row", gap: 10, marginVertical: 8, alignItems: "flex-start" },
  aiMark: { width: 28, height: 28, borderRadius: 9, backgroundColor: Hearth.ember500, alignItems: "center", justifyContent: "center", marginTop: 2 },
  aiText: { fontSize: 15, color: Hearth.ink800, lineHeight: 22 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: Hearth.border, backgroundColor: Hearth.surface },
  input: { flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: Hearth.rim, borderWidth: 1, borderColor: Hearth.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Hearth.ink900 },
  sendBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: Hearth.ember400, alignItems: "center", justifyContent: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planTitle: { fontSize: 15, fontWeight: "700", color: Hearth.ink900, flex: 1 },
  step: { flexDirection: "row", gap: 8, backgroundColor: Hearth.surfaceSunken, borderRadius: 12, padding: 10 },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: Hearth.rim, textAlign: "center", lineHeight: 20, fontSize: 11, fontWeight: "700", color: Hearth.ink600, overflow: "hidden" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
});
