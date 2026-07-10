// Ask Famili — the one front door. A first-class iOS chat that answers,
// drafts executable plans (run via the durable run flow), and builds helpers
// (skills/agents/automations) straight from conversation. Streams via
// /api/assistant/stream with a silent fallback to POST /api/assistant.
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, {
  FadeInDown, ReduceMotion, cancelAnimation,
  useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { api, type AgentPlan, type AssistantResult, type ChatBuild, type ConversationRec, type RunRec } from "@/lib/api";
import { streamAssistant } from "@/lib/assistant-stream";
import { useSession } from "@/lib/session";
import { useRun } from "@/lib/run-context";
import { useTheme, useCalmMotion, riskColor, tapHaptic } from "@/theme";
import { humanDetail } from "@/lib/format";
// NOTE: explicit /index path — the legacy src/components/ui.tsx (old design
// system, deleted with the old screens) shadows the ui/ directory otherwise.
import { Badge, Button, Card, MarkdownText, Notice, PressableScale, Sym, SymTile, T } from "@/components/ui";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  plan?: AgentPlan;
  build?: ChatBuild;
  built?: boolean;
  error?: boolean;
  runId?: string; // plan messages that the server already started executing
}

interface Suggestion { text: string; icon: string }

// Estimated clearance for the floating native tab bar (49pt bar; the window
// safe-area inset is added separately). When the keyboard is up the bar is
// covered, so the composer hugs the keyboard instead.
const TAB_BAR_CLEARANCE = 56;

export default function AskScreen() {
  const { colors, spacing, radii, type, dark } = useTheme();
  const calm = useCalmMotion();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { startRun, activeRun } = useRun();
  const canBuild = session?.role === "Owner" || session?.role === "Adult Admin";

  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"thinking" | "writing">("thinking");
  const [buildingId, setBuildingId] = useState<string | null>(null);
  // Server-durable thread: created on the first send so both turns persist and
  // the same conversation shows up on the web. Opening a recent chat resumes it.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [recent, setRecent] = useState<ConversationRec[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [kbVisible, setKbVisible] = useState(false);

  const scroller = useRef<ScrollView>(null);
  const instantScroll = useRef(false);
  const revealRef = useRef<{ timer: ReturnType<typeof setInterval>; msgId: string; full: string } | null>(null);

  /* ---------- progressive reveal (client-side; the server streams progress
     pings, not text — see src/lib/assistant-stream.ts) ---------- */
  const setMsgText = useCallback((id: string, t: string) => {
    setMsgs((m) => m.map((x) => (x.id === id ? { ...x, text: t } : x)));
  }, []);

  const flushReveal = useCallback(() => {
    const r = revealRef.current;
    if (!r) return;
    clearInterval(r.timer);
    revealRef.current = null;
    setMsgText(r.msgId, r.full);
  }, [setMsgText]);

  const revealInto = useCallback((msgId: string, full: string) => {
    if (calm || full.length <= 48) { setMsgText(msgId, full); return; }
    const step = Math.max(3, Math.ceil(full.length / 36));
    let shown = 0;
    const timer = setInterval(() => {
      shown = Math.min(full.length, shown + step);
      if (shown >= full.length) {
        clearInterval(timer);
        revealRef.current = null;
        setMsgText(msgId, full);
      } else {
        setMsgText(msgId, full.slice(0, shown));
      }
    }, 24);
    revealRef.current = { timer, msgId, full };
  }, [calm, setMsgText]);

  useEffect(() => () => { if (revealRef.current) clearInterval(revealRef.current.timer); }, []);

  /* ---------- home data: recent chats + personalized suggestions ---------- */
  const loadHome = useCallback(async () => {
    const [convs, approvals, events, tasks] = await Promise.all([
      api.conversations(), api.approvals(), api.events(), api.tasks(),
    ]);
    setRecent(convs.slice(0, 8));
    // Signal-based suggestions (mirror of the web's suggestAskPrompts): built
    // from what's actually going on in THIS household right now, role-aware.
    const out: Suggestion[] = [];
    const pending = approvals.filter((a) => a.status === "pending").length;
    if (pending > 0 && canBuild) out.push({ text: pending === 1 ? "What's waiting on my approval?" : `Summarize the ${pending} approvals waiting on me`, icon: "checkmark.shield" });
    const today = new Date().toISOString().slice(0, 10);
    const todays = events.filter((e) => (e.startAt ?? "").startsWith(today)).length;
    if (todays > 0) out.push({ text: "What does the family's day look like?", icon: "calendar" });
    const nowIso = new Date().toISOString();
    const overdue = tasks.filter((t) => t.status !== "done" && t.dueAt && t.dueAt < nowIso).length;
    if (overdue > 0) out.push({ text: `Help me knock out my ${overdue} overdue task${overdue === 1 ? "" : "s"}`, icon: "checklist" });
    if (out.length < 3) out.push({ text: "Plan this week's meals and build a grocery list", icon: "fork.knife" });
    if (out.length < 3) out.push({ text: "Set up a helper that triages our family inbox", icon: "tray.full" });
    if (out.length < 4) out.push({ text: "What can you do for our household?", icon: "sparkles" });
    setSuggestions(out.slice(0, 4));
  }, [canBuild]);

  useEffect(() => { if (session) void loadHome(); }, [session, loadHome]);

  /* ---------- keyboard: composer hugs the keyboard; clears the tab bar otherwise ---------- */
  useEffect(() => {
    const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEv, () => {
      setKbVisible(true);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    });
    const h = Keyboard.addListener(hideEv, () => setKbVisible(false));
    return () => { s.remove(); h.remove(); };
  }, []);

  /* ---------- conversations ---------- */
  const mapServerMessages = useCallback((c: ConversationRec): Msg[] =>
    c.messages.map((m, i) => ({
      id: `${c.id}-${i}`, role: m.role, text: m.text,
      plan: m.plan ?? undefined, build: m.build ?? undefined, built: !!m.built,
      error: m.kind === "error" || (m.kind === "run_result" && m.status === "failed"),
      runId: m.runId ?? undefined,
    })), []);

  const openConversation = useCallback(async (id: string) => {
    if (busy) return;
    flushReveal();
    const c = await api.conversation(id);
    if (!c) return;
    instantScroll.current = true;
    setConversationId(c.id);
    setMsgs(mapServerMessages(c));
  }, [busy, flushReveal, mapServerMessages]);

  // The server thread is the truth once runs execute server-side: results,
  // repair status lines, and save-as-helper offers all land there. Refresh
  // pulls them into the visible chat.
  const refreshConversation = useCallback(async (id: string) => {
    const c = await api.conversation(id);
    if (!c) return;
    setMsgs(mapServerMessages(c));
  }, [mapServerMessages]);

  /* ---------- server-run watching (auto-executed plans + self-repair) ---------- */
  const [serverRun, setServerRun] = useState<RunRec | null>(null);
  const watchedRuns = useRef<Set<string>>(new Set());
  const watchServerRun = useCallback((runId: string, convId: string) => {
    if (watchedRuns.current.has(runId)) return;
    watchedRuns.current.add(runId);
    let ticks = 0;
    const poll = async () => {
      const r = await api.getRun(runId);
      if (r.run) setServerRun(r.run);
      const terminal = r.run && ["completed", "failed", "cancelled", "expired"].includes(r.run.status);
      if (!terminal && ticks++ < 120) { setTimeout(() => void poll(), 1500); return; }
      setServerRun(null);
      await refreshConversation(convId);
      if (r.run?.status === "failed") {
        // Self-repair happens server-side moments later: keep syncing the thread
        // and hop onto the repaired run when its status message names it.
        for (const delay of [2500, 6000, 12000, 22000]) {
          setTimeout(() => void (async () => {
            const c = await api.conversation(convId);
            if (!c) return;
            setMsgs(mapServerMessages(c));
            const repairMsg = [...c.messages].reverse().find((m) => m.kind === "status" && m.runId && m.runId !== runId);
            if (repairMsg?.runId) watchServerRun(repairMsg.runId, convId);
          })(), delay);
        }
      }
    };
    void poll();
  }, [mapServerMessages, refreshConversation]);

  // Deep link support: the Inbox screen links with /(ask)?c=<conversation id>;
  // the Approval sheet links with ?prefill=<draft message> (filled, not sent).
  const params = useLocalSearchParams<{ c?: string; prefill?: string }>();
  const handledC = useRef<string | null>(null);
  useEffect(() => {
    const id = typeof params.c === "string" && params.c ? params.c : null;
    if (!id || !session || handledC.current === id) return;
    handledC.current = id;
    void openConversation(id);
  }, [params.c, session, openConversation]);
  const handledPrefill = useRef<string | null>(null);
  useEffect(() => {
    const p = typeof params.prefill === "string" && params.prefill ? params.prefill : null;
    if (!p || handledPrefill.current === p) return;
    handledPrefill.current = p;
    setText(p);
  }, [params.prefill]);

  const newChat = useCallback(() => {
    if (busy) return;
    flushReveal();
    setConversationId(null);
    setMsgs([]);
    void loadHome();
  }, [busy, flushReveal, loadHome]);

  const confirmDeleteConversation = useCallback((c: ConversationRec) => {
    tapHaptic("warning");
    Alert.alert("Delete this chat?", `“${c.title}” will be removed from every device.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => {
          setRecent((r) => r.filter((x) => x.id !== c.id)); // optimistic
          if (conversationId === c.id) { setConversationId(null); setMsgs([]); }
          void api.deleteConversation(c.id).then((res) => { if (res.error) void loadHome(); }); // restore on failure
        },
      },
    ]);
  }, [conversationId, loadHome]);

  /* ---------- send: stream first, silently fall back to POST /api/assistant ---------- */
  const send = useCallback(async (preset?: string) => {
    const t0 = (preset ?? text).trim();
    if (!t0 || busy) return;
    flushReveal();
    const uid = String(Date.now());
    setText("");
    setPhase("thinking");
    setMsgs((m) => [...m, { id: uid, role: "user", text: t0 }]);
    setBusy(true);
    // First turn creates the durable server thread; later turns reuse it.
    let convId = conversationId;
    if (!convId) {
      const c = await api.createConversation(t0.slice(0, 60));
      if (c) {
        convId = c.id;
        setConversationId(c.id);
        setRecent((r) => [c, ...r.filter((x) => x.id !== c.id)].slice(0, 8));
      }
    }
    let r: AssistantResult;
    try {
      r = await streamAssistant(t0, { conversationId: convId ?? undefined, onProgress: () => setPhase("writing") });
    } catch {
      // Any stream failure (transport, auth, parse) → non-streaming call, so
      // behavior never regresses. The server persists the turn either way.
      r = await api.assistant(t0, { conversationId: convId ?? undefined });
    }
    setBusy(false);
    const aid = uid + "a";
    if (r.ok) {
      const full =
        r.kind === "plan" && r.plan ? (r.answer || r.plan.summary || "On it.")
        : r.kind === "build" && r.build ? (r.answer || r.build.summary || "Here's what I'll set up.")
        : (r.answer || "I'm not sure how to help with that yet.");
      setMsgs((m) => [...m, {
        id: aid, role: "assistant", text: "",
        plan: r.kind === "plan" ? r.plan ?? undefined : undefined,
        build: r.kind === "build" ? r.build ?? undefined : undefined,
        runId: r.run?.id,
      }]);
      revealInto(aid, full);
      // Do-requests already started executing server-side — watch the run live;
      // its results (and any self-repair) come back into this thread.
      if (r.run?.id && convId) watchServerRun(r.run.id, convId);
    } else {
      setMsgs((m) => [...m, {
        id: aid, role: "assistant", error: true,
        text: r.error === "no_provider"
          ? "I need an AI provider connected (Settings → AI Providers), then ask me again."
          : (r.message || "I couldn't reach the AI provider just now."),
      }]);
    }
  }, [busy, conversationId, flushReveal, revealInto, text, watchServerRun]);

  /* ---------- plan + build actions ---------- */
  // Runs stay IN the chat: live progress renders inline below the messages and
  // the finished run's results come back as a chat message (no Activity detour).
  const expectRunResult = useRef(false);
  const handledRunRef = useRef<string | null>(null);
  const runPlan = useCallback(async (plan: AgentPlan) => {
    expectRunResult.current = true;
    await startRun(plan);
  }, [startRun]);

  useEffect(() => {
    if (!activeRun || !expectRunResult.current) return;
    if (activeRun.status !== "completed" && activeRun.status !== "failed") return;
    if (handledRunRef.current === activeRun.id) return;
    handledRunRef.current = activeRun.id;
    expectRunResult.current = false;
    void (async () => {
      const arts = (await api.artifacts().catch(() => [])).filter((a) => a.runId === activeRun.id);
      const done = activeRun.steps.filter((s) => s.status === "done").length;
      const stepLines = activeRun.steps
        .filter((s) => s.output && s.status === "done")
        .slice(0, 3)
        .map((s) => `- **${s.title}**: ${humanDetail(s.output) ?? ""}`)
        .filter((l) => !l.endsWith(": "));
      const artLines = arts.slice(0, 3).map((a) => `- **${a.title}**${a.body ? `\n\n${a.body.slice(0, 600)}` : ""}`);
      const text = activeRun.status === "completed"
        ? `Done — **${activeRun.planTitle}** finished (${done}/${activeRun.steps.length} steps).${stepLines.length ? `\n\n${stepLines.join("\n")}` : ""}${artLines.length ? `\n\n${artLines.join("\n\n")}` : ""}`
        : `**${activeRun.planTitle}** didn't finish — ${activeRun.steps.find((s) => s.status === "blocked")?.output ?? "a step failed."} You can adjust the plan and try again.`;
      setMsgs((m) => [...m, { id: `run-${activeRun.id}`, role: "assistant", text, error: activeRun.status === "failed" }]);
      // Persist into the server-durable thread so the result survives app
      // restarts and shows on the web too.
      if (conversationId) void api.appendConversationMessage(conversationId, { text, kind: "run_result", runId: activeRun.id });
    })();
  }, [activeRun, conversationId]);

  const runBuild = useCallback(async (msgId: string, build: ChatBuild) => {
    setBuildingId(msgId);
    // conversationId travels so built state + confirmation persist server-side.
    const res = await api.buildFromChat(build, conversationId ?? undefined);
    setBuildingId(null);
    if (res.ok) {
      tapHaptic("success");
      const cr = res.created ?? {};
      const parts = [
        cr.skill && `skill “${cr.skill.name}”`,
        cr.agent && `helper “${cr.agent.name}”`,
        cr.automation && `automation “${cr.automation.name}”`,
        ...(res.updated ?? []).filter((u) => u.ok).map((u) => `updated ${u.kind}`),
      ].filter(Boolean);
      setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, built: true } : x)).concat({
        id: msgId + "done", role: "assistant",
        text: `Done — I set up ${parts.join(", ")}.${res.notes?.length ? "\n\n" + res.notes.map((n) => `- ${n}`).join("\n") : ""}`,
      }));
    } else {
      tapHaptic("error");
      setMsgs((m) => m.concat({
        id: msgId + "err", role: "assistant", error: true,
        text: res.error === "insufficient_role"
          ? "Only an Owner or Adult Admin can build helpers."
          : (res.message || "Couldn't build that."),
      }));
    }
  }, [conversationId]);

  /* ---------- render ---------- */
  const composerPadBottom = kbVisible ? spacing.sm : insets.bottom + TAB_BAR_CLEARANCE;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => { tapHaptic("light"); newChat(); }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="New chat"
            >
              <Sym name="square.and.pencil" size={20} color={colors.ember} />
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.sm, flexGrow: 1 }}
          onContentSizeChange={() => {
            if (!msgs.length && !busy) return;
            scroller.current?.scrollToEnd({ animated: !instantScroll.current });
            instantScroll.current = false;
          }}
        >
          {/* Conversation switcher: recent chats as chips; long-press deletes. */}
          {recent.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -spacing.lg, flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center" }}
              keyboardShouldPersistTaps="handled"
            >
              <ConvChip icon="plus" label="New" onPress={newChat} />
              {recent.map((c) => (
                <ConvChip
                  key={c.id}
                  label={c.title || "Untitled chat"}
                  selected={c.id === conversationId}
                  onPress={() => void openConversation(c.id)}
                  onLongPress={() => confirmDeleteConversation(c)}
                  hint="Long press to delete"
                />
              ))}
            </ScrollView>
          ) : null}

          {msgs.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm }}>
              <LinearGradient
                colors={[colors.hero1, colors.hero2]}
                start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }}
                style={{ width: 64, height: 64, borderRadius: 17, borderCurve: "continuous", alignItems: "center", justifyContent: "center" }}
              >
                <Sym name="sparkles" size={30} color={colors.heroText} />
              </LinearGradient>
              <T kind="h1" center style={{ fontSize: 24, lineHeight: 30 }}>
                Ask Famili{session?.actorName ? `, ${session.actorName.split(" ")[0]}` : ""}
              </T>
              <T kind="sub" center style={{ maxWidth: 300 }}>
                Tell me what your family needs. I'll answer, or draft a plan you can approve and run.
              </T>
              {activeRun ? (
                <PressableScale
                  onPress={() => router.push("/activity")}
                  haptic="select"
                  accessibilityRole="button"
                  accessibilityLabel="Run in progress — tap to view"
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, backgroundColor: colors.emberBg, borderRadius: radii.md, borderCurve: "continuous", paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
                >
                  <Sym name="waveform.path.ecg" size={14} color={colors.ember} />
                  <T kind="subMedium" color={colors.ember}>Run in progress — tap to view</T>
                </PressableScale>
              ) : null}
            </View>
          ) : null}

          {msgs.length === 0 && suggestions.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <T kind="eyebrow">For you right now</T>
              {/* 2×2 suggestion grid per the handoff */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {suggestions.map((s) => (
                  <PressableScale
                    key={s.text}
                    onPress={() => void send(s.text)}
                    haptic="light"
                    accessibilityRole="button"
                    accessibilityLabel={s.text}
                    style={{
                      flexBasis: "47%", flexGrow: 1, gap: 8,
                      backgroundColor: colors.surface, borderWidth: 1, borderColor: dark ? colors.rim : colors.border,
                      borderRadius: radii.md, borderCurve: "continuous", padding: 13,
                    }}
                  >
                    <SymTile name={s.icon} color={colors.ember} bg={colors.emberBg} size={30} iconSize={14} />
                    <T kind="subMedium" color={colors.textSecondary} numberOfLines={2}>{s.text}</T>
                  </PressableScale>
                ))}
              </View>
            </View>
          ) : null}

          {msgs.map((m) => {
            const plan = m.plan;
            const build = m.build;
            if (m.role === "user") {
              // Handoff: user bubbles are fixed ink-navy in BOTH modes (18/18/4/18).
              return (
                <Animated.View key={m.id} entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)} style={{ alignItems: "flex-end" }}>
                  <View style={{ backgroundColor: "#2A3147", borderRadius: 18, borderBottomRightRadius: 4, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 10, maxWidth: "86%" }}>
                    <T selectable color="#F3EDE1">{m.text}</T>
                  </View>
                </Animated.View>
              );
            }
            return (
              <Animated.View key={m.id} entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)} style={{ alignItems: "flex-start" }}>
                <View style={{ maxWidth: "94%", alignSelf: "stretch", gap: spacing.sm }}>
                  <Card padded={false} style={{ padding: spacing.md, borderTopLeftRadius: 6, alignSelf: "flex-start", maxWidth: "100%" }}>
                    {m.error
                      ? <T selectable color={colors.coral}>{m.text}</T>
                      : <MarkdownText text={m.text} />}
                  </Card>
                  {plan ? <PlanCard plan={plan} autoRun={!!m.runId} onRun={() => void runPlan(plan)} /> : null}
                  {build ? (
                    <BuildCard
                      build={build}
                      built={!!m.built}
                      busy={buildingId === m.id}
                      canBuild={canBuild}
                      onBuild={() => void runBuild(m.id, build)}
                    />
                  ) : null}
                </View>
              </Animated.View>
            );
          })}

          {/* Auto-executed server run: live step progress inline in the thread. */}
          {serverRun && msgs.length > 0 && !["completed", "failed", "cancelled", "expired"].includes(serverRun.status) ? (
            <Card style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <T kind="h3" color={colors.text} style={{ flex: 1 }}>{serverRun.title}</T>
                <Badge
                  label={serverRun.status === "waiting_approval" ? "Needs approval" : "Doing it"}
                  fg={serverRun.status === "waiting_approval" ? colors.amber : colors.ember}
                  bg={serverRun.status === "waiting_approval" ? colors.amberBg : colors.emberBg}
                />
              </View>
              {serverRun.steps.map((s, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: ["succeeded", "done", "completed"].includes(s.status) ? colors.sage
                      : s.status === "running" ? colors.ember
                      : s.status === "failed" ? colors.coral
                      : s.status === "waiting_approval" ? colors.amber : colors.textFaint,
                  }} />
                  <T kind="sub" color={colors.textSecondary} numberOfLines={1} style={{ flex: 1 }}>{s.title}</T>
                </View>
              ))}
            </Card>
          ) : null}

          {/* Live run progress, inline in the thread (runs never leave the chat). */}
          {activeRun && msgs.length > 0 && activeRun.status !== "completed" && activeRun.status !== "failed" ? (
            <Card style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <T kind="h3" color={colors.text} style={{ flex: 1 }}>{activeRun.planTitle}</T>
                <Badge
                  label={activeRun.status === "waiting" ? "Needs approval" : "Running"}
                  fg={activeRun.status === "waiting" ? colors.amber : colors.ember}
                  bg={activeRun.status === "waiting" ? colors.amberBg : colors.emberBg}
                />
              </View>
              {activeRun.steps.map((s, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: s.status === "done" ? colors.sage : s.status === "running" ? colors.ember : s.status === "blocked" ? colors.amber : colors.textFaint,
                  }} />
                  <T kind="sub" color={colors.textSecondary} numberOfLines={1} style={{ flex: 1 }}>{s.title}</T>
                </View>
              ))}
              {activeRun.status === "waiting" ? (
                <PressableScale onPress={() => router.push("/(home)")} haptic="select" style={{ paddingTop: 2 }}>
                  <T kind="subMedium" color={colors.ember}>A step is waiting for your approval — review it on Today</T>
                </PressableScale>
              ) : null}
            </Card>
          ) : null}

          {busy ? <TypingBubble phase={phase} /> : null}
        </ScrollView>

        {/* Composer */}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: composerPadBottom, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message Famili"
            placeholderTextColor={colors.textFaint}
            multiline
            accessibilityLabel="Message"
            style={{
              flex: 1, minHeight: 44, maxHeight: 120,
              backgroundColor: colors.surfaceSunken, borderRadius: 22, borderCurve: "continuous",
              paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
              ...type.body, color: colors.text,
            }}
          />
          <PressableScale
            onPress={() => void send()}
            disabled={!text.trim() || busy}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: colors.ember, alignItems: "center", justifyContent: "center",
              opacity: !text.trim() || busy ? 0.45 : 1,
            }}
          >
            <Sym name="arrow.up" size={19} color={colors.onEmber} />
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ------------------------------ pieces ------------------------------ */

function ConvChip({ label, icon = "bubble.left", selected, onPress, onLongPress, hint }: {
  label: string; icon?: string; selected?: boolean; onPress?: () => void; onLongPress?: () => void; hint?: string;
}) {
  const { colors, dark } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: !!selected }}
      style={{
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
        backgroundColor: selected ? colors.ember : colors.surface,
        borderWidth: 1, borderColor: selected ? colors.ember : dark ? colors.rim : colors.border,
        maxWidth: 220,
      }}
    >
      <Sym name={icon} size={12} color={selected ? colors.onEmber : colors.textFaint} />
      <T kind="subMedium" color={selected ? colors.onEmber : colors.textSecondary} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </T>
    </PressableScale>
  );
}

/** Three softly pulsing dots — the "assistant is working" bubble. */
function TypingBubble({ phase }: { phase: "thinking" | "writing" }) {
  const { spacing } = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)} style={{ alignItems: "flex-start" }}>
      <Card padded={false} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 12, borderTopLeftRadius: 6 }}>
        <View style={{ flexDirection: "row", gap: 5 }}>
          <TypingDot delay={0} />
          <TypingDot delay={140} />
          <TypingDot delay={280} />
        </View>
        <T kind="caption">{phase === "writing" ? "Writing…" : "Thinking…"}</T>
      </Card>
    </Animated.View>
  );
}

function TypingDot({ delay }: { delay: number }) {
  const { colors } = useTheme();
  const v = useSharedValue(0.3);
  useEffect(() => {
    v.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 300, reduceMotion: ReduceMotion.System }),
          withTiming(0.3, { duration: 300, reduceMotion: ReduceMotion.System }),
        ),
        -1, false, undefined, ReduceMotion.System,
      ),
    );
    return () => cancelAnimation(v);
  }, [delay, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (0.65 - v.value) * 3 }] }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textFaint }, style]} />;
}

/** Plan card. autoRun plans are ALREADY executing server-side — no button,
 * just the step outline while live progress renders below in the thread. */
function PlanCard({ plan, onRun, autoRun }: { plan: AgentPlan; onRun: () => void; autoRun?: boolean }) {
  const { colors, spacing } = useTheme();
  const rc = riskColor(colors, plan.risk);
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <T kind="h3" color={colors.text} style={{ flex: 1 }}>{plan.title}</T>
        <Badge label={`${plan.risk} risk`} fg={rc.fg} bg={rc.bg} />
      </View>
      <T kind="sub" style={{ marginTop: 2 }}>
        {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"} · {plan.triggerType}
      </T>
      <View style={{ marginTop: spacing.md }}>
        {plan.steps.map((s, i) => {
          const last = i === plan.steps.length - 1;
          return (
            <View key={i} style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ alignItems: "center", width: 22 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
                  <T kind="caption" color={colors.textMuted}>{i + 1}</T>
                </View>
                {!last ? <View style={{ flex: 1, width: 2, borderRadius: 1, backgroundColor: colors.border, marginVertical: 4 }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: last ? 0 : spacing.md }}>
                <T kind="bodyMedium" color={colors.text}>{s.title}</T>
                {s.detail ? <T kind="sub">{s.detail}</T> : null}
                {s.connectorName || s.requiresApproval ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {s.connectorName ? (
                      <Badge
                        icon={s.connected ? "link" : "link.badge.plus"}
                        label={s.connected ? s.connectorName : `${s.connectorName} · connect`}
                        fg={s.connected ? colors.sage : colors.amber}
                        bg={s.connected ? colors.sageBg : colors.amberBg}
                      />
                    ) : null}
                    {s.requiresApproval ? (
                      <Badge icon="lock.fill" label="Approval" fg={colors.coral} bg={colors.coralBg} />
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
      {autoRun ? (
        <T kind="sub" style={{ marginTop: spacing.md }}>
          Already on it — progress and results land right here in the chat.{plan.approvalRequired ? " Risky steps will pause for your approval." : ""}
        </T>
      ) : (
        <>
          <View style={{ marginTop: spacing.md }}>
            <Button title="Run this plan" variant="ember" icon="play.fill" full onPress={onRun} />
          </View>
          {plan.approvalRequired ? (
            <T kind="sub" style={{ marginTop: spacing.sm }}>Risky steps pause for your approval — the run and its results stay right here in the chat.</T>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Proposed build: entities to create/update, Owner/Adult Admin approve action. */
function BuildCard({ build, built, busy, canBuild, onBuild }: {
  build: ChatBuild; built: boolean; busy: boolean; canBuild: boolean; onBuild: () => void;
}) {
  const { colors, spacing } = useTheme();
  const edits = build.edits ?? [];
  const editOnly = !build.skill && !build.agent && !build.automation && edits.length > 0;
  const skillSteps = build.skill?.steps?.length ?? 0;
  return (
    <Card>
      <T kind="h3" color={colors.text}>{built ? "Built" : editOnly ? "I'll update this" : "I'll set this up"}</T>
      {build.summary ? <T kind="sub" style={{ marginTop: 2 }}>{build.summary}</T> : null}
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        {build.skill ? (
          <EntityRow
            icon="list.bullet" fg={colors.sky} bg={colors.skyBg} kind="Skill" name={build.skill.name}
            sub={build.skill.description || (skillSteps ? `${skillSteps} step${skillSteps === 1 ? "" : "s"}` : undefined)}
          />
        ) : null}
        {build.agent ? <EntityRow icon="cpu" fg={colors.lavender} bg={colors.lavenderBg} kind="Helper" name={build.agent.name} sub={build.agent.purpose} /> : null}
        {build.automation ? <EntityRow icon="clock.arrow.circlepath" fg={colors.amber} bg={colors.amberBg} kind="Automation" name={build.automation.name} sub={build.automation.type} /> : null}
        {edits.map((e, i) => (
          <EntityRow key={i} icon="pencil" fg={colors.textMuted} bg={colors.surfaceSunken} kind={`Update ${e.kind}`} name={e.id} sub={e.summary} />
        ))}
      </View>
      {built ? (
        <View style={{ marginTop: spacing.md }}>
          <Notice ok text="Done — your new helper is live with its tools preselected. Find it under Helper Agents." />
        </View>
      ) : !canBuild ? (
        <T kind="sub" style={{ marginTop: spacing.md }}>Only an Owner or Adult Admin can build helpers.</T>
      ) : (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Button
            title={busy ? (editOnly ? "Applying…" : "Building…") : (editOnly ? "Approve & apply" : "Approve & build")}
            variant="ember" icon="hammer.fill" full loading={busy} onPress={onBuild}
          />
          <T kind="sub" center>
            {editOnly ? "Changes are versioned and reversible." : "Creates a draft — gated steps still ask for approval."}
          </T>
        </View>
      )}
    </Card>
  );
}

function EntityRow({ icon, fg, bg, kind, name, sub }: {
  icon: string; fg: string; bg: string; kind: string; name: string; sub?: string;
}) {
  const { colors, spacing, radii } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous", padding: spacing.sm + 2 }}>
      <SymTile name={icon} color={fg} bg={bg} size={30} />
      <View style={{ flex: 1 }}>
        <T kind="subMedium" color={colors.text} numberOfLines={1}>{kind} · {name}</T>
        {sub ? <T kind="sub" numberOfLines={2}>{sub}</T> : null}
      </View>
    </View>
  );
}
