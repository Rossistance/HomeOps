// Ask Famili — the one front door. A first-class iOS chat that answers, calls tools and
// shows the receipts. Streams via /api/assistant/stream with a silent fallback to POST
// /api/assistant.
//
// THE BUILD CARD IS GONE. The engine used to reply with a proposal — a skill, an agent, an
// automation — and a big "Approve & build" button under a summary of entities nobody had
// asked about by those names. Two things were wrong with it. The summary was not the thing
// being built (the instructions were, and they were never shown), and approving it was a
// second, quieter permission system sitting next to the real one.
//
// The assistant creates a Helper itself now and says so in prose, like it says everything
// else. If you want to see what it made, it is on the Helpers tab, whole and editable. That
// is one place instead of two, and the text you read there is the text that runs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { prepareImage } from "@/lib/prepare-image";
import { AttachmentTile } from "@/components/AttachmentTile";
import { LinkCards, linksIn } from "@/components/LinkCards";
import { readAsStringAsync } from "expo-file-system/legacy";
import Animated, {
  FadeInDown, ReduceMotion, cancelAnimation, clamp, runOnJS,
  useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { api, type AgentPlan, type AssistantResult, type AssistantToolCall, type ConversationRec, type MemberRec, type NestRec, type ResultGroupRec, type RunRec } from "@/lib/api";
import { ResultCards } from "@/components/ResultCards";
import { streamAssistant, type AssistantPhase } from "@/lib/assistant-stream";
import { coversDay } from "@/lib/event-days";
import { getLocationContext } from "@/lib/location";
import { canManageHousehold, canManageOwn, capabilitiesFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { useTabBarClearance } from "@/lib/tab-bar";
import { useRun } from "@/lib/run-context";
import { useTheme, useCalmMotion, riskColor, tapHaptic } from "@/theme";
import { humanDetail } from "@/lib/format";
import { depth, rimColor } from "@/theme/neumorph";
// NOTE: explicit /index path — the legacy src/components/ui.tsx (old design
// system, deleted with the old screens) shadows the ui/ directory otherwise.
import { Badge, Button, Card, Coach, DictateButton, EmptyState, FamiliMark, GoArrow, MarkdownText, PressableScale, ScreenTour, Sym, SymTile, T, useDictation } from "@/components/ui";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Legacy only — a plan from the engine that came before Helpers, persisted on an old
   *  thread. New turns never carry one; the card stays so an old thread is still usable. */
  plan?: AgentPlan;
  error?: boolean;
  runId?: string; // plan messages that the server already started executing
  // K2 — what the run actually fetched, as cards, in line. "still not returned in line, in
  // chat, results as cards."
  resultGroups?: ResultGroupRec[];
  /** The tools this turn called — a quiet receipt under the reply, never the reply itself. */
  toolCalls?: AssistantToolCall[];
  /** What rode along with this message, so the bubble can show it rather than name it. */
  attachments?: { key: string; name: string; uri?: string; mime?: string }[];
}

/**
 * Strip the "[Attached: …]" line the send path prepends.
 *
 * That prefix is addressed to the MODEL — it's how the server knows what rode along with the
 * turn. With a real thumbnail above the bubble it would be the same fact told twice, the second
 * time worse, so the bubble shows only what the person actually typed. Written out rather than
 * inlined because it's needed in two places and a regex duplicated is a regex that drifts.
 */
function withoutAttachmentPrefix(text: string): string {
  const t = String(text ?? "");
  if (!t.startsWith("[Attached:")) return t;
  const close = t.indexOf("]");
  if (close === -1) return t;
  const rest = t.slice(close + 1);
  return rest.startsWith("\n") ? rest.slice(1) : rest;
}

interface Suggestion { text: string; icon: string }

/** One picked file on its way to (or arrived in) the library. `id` exists once uploaded. */
interface Attachment {
  /** Local, stable for the life of the bubble — the server id arrives later. */
  key: string;
  name: string;
  id?: string;
  status: "uploading" | "ready" | "failed";
  /** Why it failed, in the words we'd show a person. */
  error?: string;
  /* L2/L4 — "I need to see a very small box that depicts it, whether it's an image, a document
   * or any sort of file… a miniature thumbnail of them, just like you would see in ChatGPT."
   * The local uri is kept so a picked photo appears the instant you pick it, rather than after
   * a round trip — the thumbnail is the receipt for the tap. */
  uri?: string;
  mime?: string;
}

/** "personal" | "household" | "nest:<id>" — the three places a chat can live. */
type SpaceKey = "personal" | "household" | `nest:${string}`;

/* "Photos, files, documents, videos, whatever seem to have a 5 MB cap, which is very small."
 * 25 MB now, matching the server (index.mjs MAX_FILE_BYTES). Base64 inflates by 4/3, and the
 * request ceiling above it is sized to clear that. */
const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

/** A run parked on an approval. The engine writes "waiting_for_approval" (server/engine.mjs);
 *  "waiting_approval" is kept as a fallback so nothing that ever sent it regresses. */
const PARKED_RUN_STATUSES = ["waiting_for_approval", "waiting_approval"];

/** A run that will not change again — mirrors TERMINAL_RUN_STATUSES in server/engine.mjs.
 *  "partially_failed" is terminal too; without it the live card stayed up and the poll kept
 *  going until its 120 x 1.5 s budget ran out. The thread's result message says what happened. */
const TERMINAL_RUN_STATUSES = ["completed", "partially_failed", "failed", "cancelled", "expired"];

export default function AskScreen() {
  const { colors, spacing, radii, type, dark } = useTheme();
  const calm = useCalmMotion();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { session } = useSession();
  const { startRun, activeRun } = useRun();
  // Approvals are an adult's job, so only an adult is offered a prompt about them.
  const canApprove = canManageOwn(session?.role);
  const isAdmin = canManageHousehold(session?.role);

  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  /* What the assistant is doing, for the working bubble. "thinking" and "writing" are
   * inferred locally from token flow; "searching" and "creating" are only ever set because
   * the SERVER said so. Once the server has spoken, the token ping stops being allowed to
   * overwrite it — a web lookup emits no tokens while it fetches but the provider's earlier
   * tokens are still arriving, and letting those win is how "Searching…" would flicker back
   * to "Writing…" a beat after appearing. */
  const [phase, setPhase] = useState<AssistantPhase>("thinking");
  const phaseLockedRef = useRef(false);
  /* The tool the server is calling right now, by its human label — "Working: Calendar" under
   * the dots. Cleared when the call finishes; the receipt row under the reply is the record. */
  const [working, setWorking] = useState<string | null>(null);
  // Server-durable thread: created on the first send so both turns persist and
  // the same conversation shows up on the web. Opening a recent chat resumes it.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Chat space: personal (private to you — the default, how chats have always
  // worked) or family (shared — any household member can read and continue it).
  /* A chat lives in one of three places now — "it would say Personal, and then GPop + Beannie
   * as its own group, the way it does for the whole household where it says personal or
   * family". A nest is identified by its id; personal and household are the two fixed ones. */
  const [space, setSpace] = useState<"personal" | "household">("personal");
  const [nestId, setNestId] = useState<string | null>(null);
  const [myNests, setMyNests] = useState<NestRec[]>([]);
  const [recent, setRecent] = useState<ConversationRec[]>([]);
  const [movingSpace, setMovingSpace] = useState(false);
  // M1/M7 — the header condenses once a thread is going, and drags back open.
  const [headerOpen, setHeaderOpen] = useState(true);
  // M6 — the composer's ceiling, dragged by the grabber above it.
  const [composerMax, setComposerMax] = useState(120);
  const composerMaxRef = useRef(120);
  const setComposerMaxJS = useCallback((v: number) => { composerMaxRef.current = v; setComposerMax(v); }, []);
  const composerDrag = useMemo(() => Gesture.Pan()
    .onUpdate((e) => {
      // Dragging UP (negative y) makes it taller. Bounded so it can't swallow the thread.
      const next = Math.max(88, Math.min(360, composerMaxRef.current - e.translationY));
      runOnJS(setComposerMaxJS)(next);
    }), [setComposerMaxJS]);
  const headerT = useSharedValue(1);          // 1 = open, 0 = condensed
  const headerStyle = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * headerT.value }));
  const setHeaderOpenJS = useCallback((v: boolean) => setHeaderOpen(v), []);
  const headerDrag = useMemo(() => Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onUpdate((e) => { headerT.value = clamp(headerT.value + e.velocityY / 6000, 0, 1); })
    .onEnd((e) => {
      // Downward flick opens, upward condenses; otherwise settle to whichever is nearer.
      const open = e.velocityY > 250 ? true : e.velocityY < -250 ? false : headerT.value > 0.5;
      headerT.value = withSpring(open ? 1 : 0, { damping: 18, stiffness: 220, reduceMotion: ReduceMotion.System });
      runOnJS(setHeaderOpenJS)(open);
    }), [headerT, setHeaderOpenJS]);
  useEffect(() => { headerT.value = withSpring(headerOpen ? 1 : 0, { damping: 18, stiffness: 220, reduceMotion: ReduceMotion.System }); }, [headerOpen, headerT]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [kbVisible, setKbVisible] = useState(false);
  // One pending attachment (uploaded immediately; referenced on the next send).
  /* Attachments, plural, each carrying its own state.
   *
   * Reported: "the toast that indicates an image is being uploaded is not apparent enough. It
   * needs to go ahead and attach the image name as a bubble above the chat like it normally
   * does, but then the loading sign needs to be on the individual item so you know which ones
   * have fully loaded."
   *
   * The old shape made that impossible: one nullable attachment that only came into existence
   * AFTER its upload finished. So during the slow part there was nothing on screen but a
   * disabled paperclip, and "which ones have fully loaded" had no answer because there was only
   * ever one and it was already done. The bubble now appears the instant you pick, with its own
   * spinner, and each one resolves independently. */
  const [attached, setAttached] = useState<Attachment[]>([]);
  // Current member record → child AI gating (server enforces 403 ai_disabled too).
  const [me, setMe] = useState<MemberRec | null>(null);

  // I2 — only this space's chats. A chat with no recorded visibility is treated as personal,
  // which is what it was created as before the field existed.
  const visibleRecent = recent.filter((c) =>
    nestId
      ? c.visibility === "nest" && c.nestId === nestId
      : c.visibility !== "nest" && (c.visibility === "household" ? "household" : "personal") === space);

  const scroller = useRef<ScrollView>(null);
  const instantScroll = useRef(false);
  const justSentRef = useRef(false);
  /* Follow the bottom while a reply is arriving.
   *
   * Reported: "the response does not cause the viewport for the chat to scroll down, so the
   * response can be visible automatically."
   *
   * The old rule was "anchor the TOP of the reply once, then don't touch the scroll position
   * while the reveal grows the text" — trying not to yank the view around on a long answer. But
   * the anchoring happened when the bubble mounted EMPTY, so it measured a zero-height bubble,
   * often scrolled nowhere at all, and then every word of the actual answer appeared below the
   * fold with nothing following it.
   *
   * This is the behaviour every chat has instead: while you're at the bottom, stay at the
   * bottom. The moment you scroll up to read something, following stops — which is the same
   * protection the old rule was reaching for, except it's driven by what you're doing rather
   * than guessed in advance. */
  const followRef = useRef(false);
  const revealRef = useRef<{ timer: ReturnType<typeof setInterval>; msgId: string; full: string } | null>(null);

  /* ---------- progressive reveal (client-side, for the paths that arrive all at once:
     the non-streaming fallback, or a server that sent no "delta" frames). When the reply
     streams as text, the deltas ARE the reveal — see send()) ---------- */
  const setMsgText = useCallback((id: string, t: string) => {
    setMsgs((m) => m.map((x) => (x.id === id ? { ...x, text: t } : x)));
  }, []);
  /** Replace the message with this id, or append it if it isn't there yet — a streamed reply
   *  creates its bubble on the first delta, so "done" must not create a second one. */
  const upsertMsg = useCallback((msg: Msg) => {
    setMsgs((m) => (m.some((x) => x.id === msg.id) ? m.map((x) => (x.id === msg.id ? { ...x, ...msg } : x)) : [...m, msg]));
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
    if (pending > 0 && canApprove) out.push({ text: pending === 1 ? "What's waiting on my approval?" : `Summarize the ${pending} approvals waiting on me`, icon: "checkmark.shield" });
    // Local calendar day, spans included — a UTC string prefix put the evening's plans on
    // tomorrow and missed a multi-day event that started yesterday.
    const now = new Date();
    const todays = events.filter((e) => coversDay(e, now)).length;
    if (todays > 0) out.push({ text: "What does the family's day look like?", icon: "calendar" });
    const nowIso = new Date().toISOString();
    const overdue = tasks.filter((t) => t.status !== "done" && t.dueAt && t.dueAt < nowIso).length;
    if (overdue > 0) out.push({ text: `Help me knock out my ${overdue} overdue task${overdue === 1 ? "" : "s"}`, icon: "checklist" });
    if (out.length < 3) out.push({ text: "Plan this week's meals and build a grocery list", icon: "fork.knife" });
    if (out.length < 3) out.push({ text: "Set up a helper that triages our family inbox", icon: "tray.full" });
    if (out.length < 4) out.push({ text: "What can you do for our household?", icon: "sparkles" });
    setSuggestions(out.slice(0, 4));
  }, [canApprove]);

  useEffect(() => { if (session) void loadHome(); }, [session, loadHome]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    void api.nests().then((n) => { if (live) setMyNests(n.nests); }).catch(() => null);
    void api.members()
      .then((ms) => { if (live) setMe(ms.find((x) => x.isCurrentUser) ?? null); })
      .catch(() => null);
    return () => { live = false; };
  }, [session]);

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
    c.messages.map((m, i) => {
      const groups = m.resultGroups?.length ? m.resultGroups : undefined;
      return {
        id: `${c.id}-${i}`, role: m.role,
        // With cards rendering the rows, the prose drops them so the same five results
        // aren't read twice — the server ships both forms of the same message.
        text: groups ? (m.textWithoutRows ?? m.text) : m.text,
        plan: m.plan ?? undefined,
        error: m.kind === "error" || (m.kind === "run_result" && m.status === "failed"),
        runId: m.runId ?? undefined,
        resultGroups: groups,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    }), []);

  const openConversation = useCallback(async (id: string) => {
    if (busy) return;
    flushReveal();
    const c = await api.conversation(id);
    if (!c) return;
    instantScroll.current = true;
    setConversationId(c.id);
    setSpace(c.visibility === "household" ? "household" : "personal");
    setNestId(c.visibility === "nest" ? (c.nestId ?? null) : null);
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
      const terminal = r.run && TERMINAL_RUN_STATUSES.includes(r.run.status);
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
  const params = useLocalSearchParams<{ c?: string; prefill?: string; draft?: string; dictate?: string; q?: string }>();
  const handledC = useRef<string | null>(null);
  useEffect(() => {
    const id = typeof params.c === "string" && params.c ? params.c : null;
    if (!id || !session || handledC.current === id) return;
    handledC.current = id;
    void openConversation(id);
  }, [params.c, session, openConversation]);
  /* Cluster R — ?q= is a question already COMMITTED on the Today card ("allow me to type
   * and dictate and send from here"). Unlike prefill (filled, not sent), q fires on
   * arrival: the person already pressed send once, and asking them to press it again is
   * the facade he was describing. */
  const handledQ = useRef<string | null>(null);
  useEffect(() => {
    const q = typeof params.q === "string" && params.q.trim() ? params.q : null;
    if (!q || !session || handledQ.current === q) return;
    handledQ.current = q;
    // send() takes the message directly — no composer round-trip, no second tap.
    setTimeout(() => { void send(q); }, 80);
  }, [params.q, session]); // eslint-disable-line react-hooks/exhaustive-deps
  const handledPrefill = useRef<string | null>(null);
  useEffect(() => {
    const p = typeof params.prefill === "string" && params.prefill ? params.prefill : null;
    if (!p || handledPrefill.current === p) return;
    handledPrefill.current = p;
    setText(p);
  }, [params.prefill]);
  // Playbooks (and others) deep-link with ?draft=<message> — filled into the
  // composer once, never sent automatically.
  const handledDraft = useRef<string | null>(null);
  useEffect(() => {
    const d = typeof params.draft === "string" && params.draft ? params.draft : null;
    if (!d || handledDraft.current === d) return;
    handledDraft.current = d;
    setText(d);
  }, [params.draft]);

  /* I3 — move THIS chat between Personal and Family. With no thread yet it's just a choice
   * about where the next one lands; with a thread it's a real visibility change, so the
   * publishing direction asks first. */
  /* Switching space switches the SPACE. It does not move the chat you happen to have open.
   *
   * Reported: "I went on a personal message and tried to switch over and look at family
   * messages. It asks if you want to share it with the family and that's not how that should
   * operate. It should just switch over to Family. The message should stay inside of personal
   * and vice versa unless the individual message is pressed and held, and an option would be
   * presented to move to Family."
   *
   * Exactly right, and the old behaviour was a category error: it read a navigation control as
   * an edit. Tapping "Family" is you asking to LOOK somewhere, and the app answered by offering
   * to publish something you'd written in private. Moving a thread is now where moving belongs —
   * a press and hold on the thread itself.
   */
  const switchSpace = useCallback((next: SpaceKey) => {
    const toNest = next.startsWith("nest:") ? next.slice(5) : null;
    tapHaptic("select");
    setNestId(toNest);
    setSpace(toNest ? "personal" : (next as "personal" | "household"));
    // Close whatever was open: it lives in the space you just left, and leaving it on screen
    // under the other space's chip is how you end up believing you moved it.
    setConversationId(null);
    setMsgs([]);
  }, []);

  /* The space pill's label and colour, and the picker behind it. One control replacing the
   * row of chips — see the note at its render site. Adult Members are silo'd, so Family isn't
   * offered to them: a menu entry that always refuses is worse than no entry. */
  const spaceLabel = nestId
    ? (myNests.find((n) => n.id === nestId)?.label ?? "Nest")
    : space === "household" ? "Family" : "Personal";
  const spaceTint = nestId ? colors.sky : space === "household" ? colors.ember : colors.lavender;

  const openSpacePicker = useCallback(() => {
    const options: { text: string; onPress?: () => void; style?: "cancel" }[] = [
      { text: "Personal", onPress: () => switchSpace("personal") },
      ...myNests.map((n) => ({ text: n.label, onPress: () => switchSpace(`nest:${n.id}` as SpaceKey) })),
      ...(isAdmin ? [{ text: "Family", onPress: () => switchSpace("household") }] : []),
      { text: "Cancel", style: "cancel" as const },
    ];
    Alert.alert("Show chats from", "Switching only changes which chats you're looking at. To move one, press and hold it.", options);
  }, [isAdmin, myNests, switchSpace]);


  /** Move ONE thread to another space — from a press and hold, where an edit belongs. */
  const moveConversation = useCallback((c: ConversationRec) => {
    // A nest thread is not movable in either direction: everyone in the nest, or everyone in the
    // household, would gain the ability to read what came before, and nobody agreed to that.
    if (c.visibility === "nest") {
      Alert.alert(
        "Nest chats stay in their nest",
        "Moving this would let people read everything already said in it. Start a new chat in the space you want instead.",
      );
      return;
    }
    const toHousehold = c.visibility !== "household";
    const commit = async () => {
      setMovingSpace(true);
      const r = await api.patchConversation(c.id, { visibility: toHousehold ? "household" : "personal" });
      setMovingSpace(false);
      if (!r.conversation) {
        Alert.alert("Couldn't move this chat", r.message ?? "Something went wrong.");
        return;
      }
      tapHaptic("success");
      setRecent((rs) => rs.map((x) => (x.id === c.id ? r.conversation! : x)));
      // It has left the space you're looking at, so it shouldn't stay open in front of you.
      if (conversationId === c.id) { setConversationId(null); setMsgs([]); }
    };
    if (toHousehold) {
      Alert.alert(
        "Share this chat with the family?",
        `Everyone in the household will be able to read “${c.title}” — including everything already said.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Share", onPress: () => void commit() }],
      );
      return;
    }
    void commit();
  }, [conversationId]);

  const newChat = useCallback(() => {
    if (busy) return;
    flushReveal();
    setConversationId(null);
    setMsgs([]);
    setNestId(null);
    void loadHome();
  }, [busy, flushReveal, loadHome]);

  /* Press and hold on a thread. Delete used to be the ONLY thing here, which is why moving had
   * been bolted onto the space chips — the gesture that should own "do something to this one
   * thread" was already spoken for by the most destructive option in the app. */
  const conversationActions = useCallback((c: ConversationRec) => {
    tapHaptic("select");
    const canMove = c.visibility !== "nest";
    Alert.alert(c.title, undefined, [
      ...(canMove ? [{
        text: c.visibility === "household" ? "Make it private" : "Move to Family",
        onPress: () => moveConversation(c),
      }] : []),
      { text: "Delete", style: "destructive" as const, onPress: () => confirmDeleteConversation(c) },
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [moveConversation]);

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
  /* E2 — "we need to add the dictation right near the send button down here that allows for
   * users to dictate." Words land in the composer as they're spoken, so you can see it working
   * and edit before sending rather than trusting it blind. */
  const inputRef = useRef<TextInput>(null);
  const { listening, toggle: toggleDictation } = useDictation(setText);

  /* E1's other half — Today's Ask card sends people here with ?dictate=1, meaning "I tapped the
   * microphone over there". Start listening on arrival so the tap does what it looked like it
   * would, rather than depositing them in a chat with a keyboard up. */
  const dictateParam = params.dictate;
  const dictateArmed = useRef(false);
  useEffect(() => {
    if (dictateParam !== "1" || dictateArmed.current) return;
    dictateArmed.current = true;
    const t = setTimeout(() => void toggleDictation(""), 350);
    return () => clearTimeout(t);
  }, [dictateParam, toggleDictation]);

  const send = useCallback(async (preset?: string) => {
    const t0 = (preset ?? text).trim();
    /* L3 — "I should be able to send, in an existing chat and a new chat, just an image with no
     * text. However right now it is greyed out if I do not have text inside of the body."
     * A photo IS the message when what you're asking is "what's in this", so an attachment
     * counts as content. Nothing and nothing is still nothing to send. */
    if ((!t0 && !attached.some((a) => a.status === "ready" && a.id)) || busy) return;
    flushReveal();
    /* Attachments ride along: named in the message text and passed as context so the planner
     * can read them. Only the ones that FINISHED — sending mid-upload would hand the server an
     * id that doesn't exist yet, and the answer to "I attached a photo, why can't you see it"
     * must never be "because we sent it before it arrived". Anything still uploading stays in
     * the tray for the next message rather than being silently dropped. */
    const ready = attached.filter((a) => a.status === "ready" && a.id);
    setAttached((as) => as.filter((a) => a.status === "uploading"));
    const names = ready.map((a) => a.name).join(", ");
    // A photo with no words still needs a message body, or the turn has nothing to persist.
    const t = ready.length ? (t0 ? `[Attached: ${names}]\n${t0}` : `[Attached: ${names}]`) : t0;
    const uid = String(Date.now());
    /* One name for this turn, shared by the stream and the fallback below. The server runs a
     * named turn once: if the stream dies AFTER the tools ran (2026-09-22: four helpers
     * flipped twice, two test tasks), the fallback gets that run's answer back instead of a
     * second run. */
    const clientTurnId = `${uid}-${Math.random().toString(36).slice(2, 8)}`;
    setText("");
    /* M1/M2/M4 — "the assistant's response is hidden down here… when I send this, this entire
     * section of keyboard needs to come all the way down. I just need to see 'Message Famili'.
     * I should be able to read the entire response, I should not have to manually scroll."
     *
     * The keyboard was staying up after send, so the reply arrived into the ~40% of the screen
     * it wasn't covering. Dismissing it is what actually gives the answer room — following the
     * scroll alone can't, because there was nowhere to follow it TO.
     *
     * M3 — "my cursor should stay active." Dismissing the keyboard normally blurs the field,
     * so the composer keeps focus explicitly: type again and the keyboard returns without a
     * tap, which is the difference between dismissing a keyboard and losing your place. */
    Keyboard.dismiss();
    // Focus survives the dismissal, so typing again brings the keyboard straight back.
    setTimeout(() => inputRef.current?.focus(), 400);
    setPhase("thinking");
    phaseLockedRef.current = false;
    justSentRef.current = true;
    // The room is needed for reading the moment a conversation starts.
    setHeaderOpen(false);
    setMsgs((m) => [...m, {
      id: uid, role: "user", text: t,
      attachments: ready.map((a) => ({ key: a.key, name: a.name, uri: a.uri, mime: a.mime })),
    }]);
    setBusy(true);
    // First turn creates the durable server thread; later turns reuse it.
    let convId = conversationId;
    const isFirstExchange = !convId;
    if (!convId) {
      const c = await api.createConversation(t0.slice(0, 60), nestId ? "nest" : space, nestId ?? undefined);
      if (c) {
        convId = c.id;
        setConversationId(c.id);
        setRecent((r) => [c, ...r.filter((x) => x.id !== c.id)].slice(0, 8));
      }
    }
    // Coarse location rides along (permission-gated, cached, city-level) so
    // "weather", "near us", and local-news requests tailor without a follow-up.
    const location = await getLocationContext();
    const ctx: Record<string, unknown> = {};
    if (location) ctx.location = location;
    /* The first attachment is the one the server reads (attachFileContext takes one file). Any
     * others are NAMED so the assistant can say what it has and hasn't looked at, rather than
     * quietly ignoring them. */
    if (ready.length) {
      ctx.attachedFileId = ready[0].id;
      ctx.attachedFileName = ready[0].name;
      if (ready.length > 1) ctx.attachedAlsoNames = ready.slice(1).map((a) => a.name);
    }
    const context = Object.keys(ctx).length ? ctx : undefined;
    const aid = uid + "a";
    /* Reply text as it streams. The bubble appears on the first delta and grows with each
     * one — the real thing, so the client-side reveal below is only for replies that arrive
     * whole. Kept in a local so a fallback mid-stream can't leave a half-bubble behind. */
    let streamed = "";
    let r: AssistantResult;
    try {
      r = await streamAssistant(t, {
        conversationId: convId ?? undefined,
        context,
        clientTurnId,
        onProgress: () => { if (!phaseLockedRef.current) setPhase("writing"); },
        onDelta: (piece) => {
          streamed += piece;
          if (!phaseLockedRef.current) setPhase("writing");
          upsertMsg({ id: aid, role: "assistant", text: streamed });
        },
        onTool: (ev) => setWorking(ev.status === "running" ? (ev.label ?? ev.tool) : null),
        onPhase: (p) => { phaseLockedRef.current = true; setPhase(p); },
      });
    } catch {
      // Any stream failure (transport, auth, parse) → non-streaming call, so
      // behavior never regresses. The server persists the turn either way.
      if (streamed) { streamed = ""; setMsgs((m) => m.filter((x) => x.id !== aid)); }
      r = await api.assistant(t, { conversationId: convId ?? undefined, context, clientTurnId });
    }
    setBusy(false);
    setWorking(null);
    /* M4 [05:32] — "it doesn't really rename like it should intelligently."
     *
     * It DOES: the server names a thread from its first exchange (I1). But the client seeded
     * `recent` with the truncated first message and never re-read it, so the chip kept the
     * stub title for the whole session and the rename was invisible. Refresh the list once,
     * after the first exchange, which is exactly when the server has just renamed it. */
    if (isFirstExchange) {
      void api.conversations().then((cs) => setRecent(cs.slice(0, 8))).catch(() => null);
    }
    if (r.ok) {
      // Every successful turn is prose now — there is no proposal branch left to unwrap.
      const full = r.answer || streamed || "I'm not sure how to help with that yet.";
      // Every run this turn started — `run` rides along with ANY kind (an "answer" whose
      // step was queued for approval still has one), so never gate this on kind.
      const runIds = [...new Set([r.run?.id, r.runId, ...(r.runIds ?? [])].filter((x): x is string => !!x))];
      upsertMsg({
        id: aid, role: "assistant", text: streamed ? full : "",
        runId: runIds[0],
        toolCalls: r.toolCalls?.length ? r.toolCalls : undefined,
      });
      // Streamed text is already on screen; only a whole-at-once reply gets the reveal.
      if (!streamed) revealInto(aid, full);
      // Runs already executing server-side — watch each live; their results (and any
      // self-repair) come back into this thread.
      if (convId) for (const id of runIds) watchServerRun(id, convId);
    } else if (r.error === "turn_in_progress" && convId) {
      /* The stream dropped, but the server is still working this turn — the fallback was
       * refused rather than run twice. The answer lands in the durable thread on its own;
       * pull the thread a few times so it appears here without the person having to leave. */
      const cid = convId;
      upsertMsg({ id: aid, role: "assistant", text: "Still working on that — it'll show up here in a moment." });
      for (const ms of [4000, 12000, 30000]) setTimeout(() => { void refreshConversation(cid); }, ms);
    } else {
      upsertMsg({
        id: aid, role: "assistant", error: true,
        text: r.error === "no_provider"
          ? "I need an AI provider connected for this household — that is set up by whoever runs this deployment."
          : (r.message || "I couldn't reach the AI provider just now."),
      });
    }
  }, [attached, busy, conversationId, flushReveal, refreshConversation, revealInto, space, text, upsertMsg, watchServerRun]);

  /* ---------- attachments ----------
   * The bubble appears the moment you pick, carrying its own spinner, and resolves on its own.
   * Everything before this was: disabled paperclip, long silence, bubble appears already done.
   */
  const putAttachment = useCallback((key: string, patch: Partial<Attachment>) => {
    setAttached((as) => as.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }, []);

  /** Upload one already-prepared file and settle its bubble either way. */
  const uploadAttachment = useCallback(async (key: string, name: string, base64: string, mime: string) => {
    const r = await api.uploadFile({ name, contentBase64: base64, mime, visibility: "household" });
    if (!r.file) {
      // Failure lands ON the bubble rather than in an alert that dismisses and leaves you
      // wondering which of three photos didn't make it.
      putAttachment(key, {
        status: "failed",
        error: r.error === "too_large" ? "Over the 25 MB cap"
          : r.error === "insufficient_role" ? "Not allowed for your role"
          : r.message ?? "Upload failed",
      });
      return;
    }
    tapHaptic("success");
    putAttachment(key, { status: "ready", id: r.file.id, name: r.file.name });
  }, [putAttachment]);

  const attachFromDocument = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (res.canceled || !res.assets?.length) return;
      for (const a of res.assets) {
        const key = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        const name = a.name ?? "document";
        if ((a.size ?? 0) > MAX_ATTACH_BYTES) {
          setAttached((as) => [...as, { key, name, status: "failed", error: "Over the 25 MB cap" }]);
          continue;
        }
        setAttached((as) => [...as, { key, name, status: "uploading", mime: a.mimeType ?? undefined }]);
        try {
          const b64 = await readAsStringAsync(a.uri, { encoding: "base64" });
          await uploadAttachment(key, name, b64, a.mimeType ?? "application/octet-stream");
        } catch (e) {
          putAttachment(key, { status: "failed", error: String((e as Error)?.message ?? "Couldn't read that file") });
        }
      }
    } catch (e) {
      Alert.alert("Couldn't attach", String((e as Error)?.message ?? e));
    }
  }, [putAttachment, uploadAttachment]);

  const attachFromPhotos = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("Photos access was denied"); return; }
      /* base64 is NOT requested from the picker any more. It used to hand back a multi-megabyte
       * string of a full-resolution photo, which is most of why "images take forever to upload
       * even small images" — the encode happened before we'd even looked at the file. We take
       * the uri and do our own resize + JPEG re-encode instead (see lib/prepare-image), which is
       * also what makes vision work at all: iPhones shoot HEIC, and vision APIs reject it. */
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsMultipleSelection: true, selectionLimit: 4 });
      if (res.canceled || !res.assets?.length) return;
      for (const a of res.assets) {
        const key = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        const name = a.fileName ?? `photo-${Date.now()}.jpg`;
        setAttached((as) => [...as, { key, name, status: "uploading", uri: a.uri, mime: "image/jpeg" }]);
        const prepped = await prepareImage(a.uri, { name, width: a.width, height: a.height });
        if (!prepped) { putAttachment(key, { status: "failed", error: "Couldn't read that photo" }); continue; }
        if (prepped.bytes > MAX_ATTACH_BYTES) { putAttachment(key, { status: "failed", error: "Over the 25 MB cap" }); continue; }
        putAttachment(key, { name: prepped.name });
        await uploadAttachment(key, prepped.name, prepped.base64, prepped.mime);
      }
    } catch (e) {
      Alert.alert("Couldn't attach", String((e as Error)?.message ?? e));
    }
  }, [putAttachment, uploadAttachment]);

  /* Take one now, rather than "go take one, come back, and find it in your library".
   *
   * The Info.plist string for this has been declared since the picker was configured — the app
   * simply never asked. Requesting at the moment of use is the point: a camera prompt that
   * appears when you tap "Take a photo" explains itself, where one fired at launch is a thing
   * people deny on principle. Denial is handled honestly too, with the one sentence that
   * actually helps: where to turn it back on. */
  const attachFromCamera = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Camera access is off",
          perm.canAskAgain
            ? "FamiliOS needs the camera to photograph something straight into the chat."
            : "Turn it on in iOS Settings → FamiliOS → Camera, then try again.",
        );
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
      const a = res.canceled ? null : res.assets?.[0];
      if (!a) return;
      const key = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const name = a.fileName ?? `photo-${Date.now()}.jpg`;
      setAttached((as) => [...as, { key, name, status: "uploading", uri: a.uri, mime: "image/jpeg" }]);
      // Same path as a picked photo: resized and re-encoded as JPEG, so a camera capture is
      // just as readable and just as quick to upload.
      const prepped = await prepareImage(a.uri, { name, width: a.width, height: a.height });
      if (!prepped) { putAttachment(key, { status: "failed", error: "Couldn't read that photo" }); return; }
      putAttachment(key, { name: prepped.name });
      await uploadAttachment(key, prepped.name, prepped.base64, prepped.mime);
    } catch (e) {
      Alert.alert("Couldn't use the camera", String((e as Error)?.message ?? e));
    }
  }, [putAttachment, uploadAttachment]);

  const pickAttachment = useCallback(() => {
    tapHaptic("light");
    Alert.alert("Attach", "Photos are resized before they're sent, so they upload quickly and the assistant can read them.", [
      { text: "Take a Photo", onPress: () => void attachFromCamera() },
      { text: "Choose from Photos", onPress: () => void attachFromPhotos() },
      { text: "Browse Files", onPress: () => void attachFromDocument() },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [attachFromCamera, attachFromDocument, attachFromPhotos]);

  /* ---------- runs from a legacy plan card ---------- */
  // Runs stay IN the chat: live progress renders inline below the messages and
  // the finished run's results come back as a chat message (no Activity detour).
  const expectRunResult = useRef(false);
  const handledRunRef = useRef<string | null>(null);
  const runPlan = useCallback(async (plan: AgentPlan) => {
    // Inside a live thread the SERVER writes the outcome: its run_result carries the rows
    // this run fetched as cards (K2) and persists, which the locally-composed summary below
    // can't do — it only ever had stringified step output. The local path stays for a run
    // started before the thread exists.
    expectRunResult.current = true;   // set BEFORE the await: a fast run can finish inside it
    const runId = await startRun(plan, { conversationId: conversationId ?? undefined });
    if (runId && conversationId) {
      expectRunResult.current = false;
      watchServerRun(runId, conversationId);
    }
  }, [conversationId, startRun, watchServerRun]);

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

  /* ---------- render ---------- */
  /* The composer clears the floating tab bar.
   *
   * This used to read "the floating native tab bar already overlays above the safe-area
   * inset, so the composer only needs the inset" — and the TestFlight report that Today's
   * last card sat behind the bar is that assumption being wrong. It is not a Today bug; it
   * is every screen that stops at the safe-area inset, and the composer is one of them.
   * See lib/tab-bar for why the height has to be a constant.
   *
   * With the keyboard up the bar is covered by it, so the composer hugs the keyboard instead.
   * M5 [05:52] — "the bottom of this message family is way too close to the top of the
   * keyboard. It needs to have a little more spacing." */
  const composerPadBottom = kbVisible ? spacing.md + 4 : tabBarClearance + 8;

  // Child members chat only when an adult flipped on aiEnabled (server 403s too).
  const caps = me ? capabilitiesFor(me) : null;
  const aiBlocked = !!caps && caps.viewMode === "child" && !caps.canUseAI;
  if (aiBlocked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: spacing.xl }}>
        <Stack.Screen options={{ headerRight: undefined }} />
        <EmptyState
          icon="sparkles"
          title="AI chat is off for your profile"
          hint="Ask a parent to turn on AI chat for your profile — they can flip it on from Settings → Household."
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          // Opaque compact header: the space toggle + recent chats pin directly
          // beneath it, so content must not scroll behind a transparent bar.
          headerTransparent: false,
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          /* K1 — "the icon on the Ask Famili screen is not the FamiliOS icon; it needs to be."
             The title carries the app's own spark rather than a bare word. */
          headerTitle: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <FamiliMark size={24} />
              <T kind="h3" color={colors.text}>Ask Famili</T>
            </View>
          ),
          /* K2 — "there needs to be a back button added to the top here." This screen is the
             root of its tab, so there is no stack entry to pop; back means Today, which is
             where the Ask card that sends people here lives. */
          headerLeft: () => (
            <Pressable
              onPress={() => { tapHaptic("select"); router.navigate("/(home)"); }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back to Today"
            >
              <Sym name="chevron.left" size={22} color={colors.ember} />
            </Pressable>
          ),
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
      {/* keyboardVerticalOffset clears the stack header so the composer sits
          directly above the keyboard when focused. @react-navigation/elements'
          useHeaderHeight isn't resolvable here, so use the safe-area top inset
          plus the standard 44pt iOS header height. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 44}
      >
        {/* M1/M7 — "make the Ask Family section slightly smaller and more condensed, that way
            there is some room to fit some of this information down below all in one screen",
            and "the personal/family needs to be condensed — just show an orange dot so it's
            obvious what section you're in, but also be able to be dragged back down, and then
            snap back."

            So the header has two states and you drag between them. Collapsed it is a single
            row: a coloured dot naming the space, and the chat chips. Expanded it is the full
            toggle with its explanation. It collapses itself the moment a conversation starts —
            which is exactly when the room is needed for reading — and a downward drag brings
            it back. The spring is what makes it feel like a thing rather than a state flip. */}
        <GestureDetector gesture={headerDrag}>
        <Animated.View style={[{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.bg }, headerStyle]}>
          {/* Space toggle: where THIS chat lives. Personal = private to you;
              Family = shared with the household. Locked once a thread exists
              (the server owns the record's visibility from creation). */}
          {/* K4/K5 — "all of these historical chats will move up a line and be in line with
              Personal… if I needed to change to Family there could be a small dropdown near a
              single bubble that lets me change in between personal and family."
              So the space toggle stopped being a row of chips and became ONE pill at the head
              of the chat row. That is the whole row he wanted back: the toggle and the threads
              now share a line, and the pill stays put while the threads scroll past it. */}
          <Coach id="ask.spaces">
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <PressableScale
              onPress={openSpacePicker}
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={`${spaceLabel} chats. Change space`}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingLeft: 11, paddingRight: 8, paddingVertical: 7, borderRadius: 999,
                backgroundColor: colors.surfaceSunken,
                borderWidth: 1, borderColor: rimColor(colors, dark),
                boxShadow: depth("raisedSm", colors, dark),
              }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: spaceTint }} />
              <T kind="detail" color={colors.text} style={{ fontWeight: "600" }}>{spaceLabel}</T>
              <Sym name="chevron.down" size={11} color={colors.textMuted} />
            </PressableScale>

            {visibleRecent.length > 0 ? (
              <Coach id="ask.threads" style={{ flex: 1 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={{ paddingRight: spacing.lg, gap: spacing.sm, alignItems: "center" }}
                  keyboardShouldPersistTaps="handled"
                >
                  {visibleRecent.map((c) => (
                    <ConvChip
                      key={c.id}
                      label={c.title || "Untitled chat"}
                      dot={c.visibility === "household" ? colors.ember : colors.lavender}
                      selected={c.id === conversationId}
                      onPress={() => void openConversation(c.id)}
                      onLongPress={() => conversationActions(c)}
                      hint="Long press to move or delete"
                    />
                  ))}
                </ScrollView>
              </Coach>
            ) : (
              <T kind="caption" color={colors.textFaint} numberOfLines={1} style={{ flex: 1 }}>
                {nestId ? "Only your nest can see this" : space === "household" ? "Shared with the household" : "Private to you"}
              </T>
            )}
          </View>
          </Coach>

          {/* The Ask chapter's entry point. It was dropped when the two header rows merged,
              which left that chapter reachable from nowhere — Settings' "Show me around" runs
              the app-wide spine, not this screen's. It's back, but under the new rules: shown
              once ever, gone after ten seconds, and only while the header is expanded. That
              answers the row it was costing without orphaning a chapter. */}
          {headerOpen ? <ScreenTour route="/(ask)" /> : null}

          {/* The grab handle — the affordance that says this can move. */}
          <View style={{ alignItems: "center", paddingTop: 2 }}>
            <View style={{ width: 34, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
        </Animated.View>
        </GestureDetector>

        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.sm, flexGrow: 1 }}
          scrollEventThrottle={32}
          onScroll={(e) => {
            // "Am I at the bottom?" — the only input the follow rule needs. 48pt of slack so a
            // half-finished flick or a rubber-band still counts as being at the bottom.
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const fromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
            followRef.current = fromBottom < 48;
          }}
          onContentSizeChange={() => {
            // Opening a thread: jump, don't animate through the whole history.
            if (instantScroll.current) {
              instantScroll.current = false;
              followRef.current = true;
              scroller.current?.scrollToEnd({ animated: false });
              return;
            }
            if (justSentRef.current) {
              justSentRef.current = false;
              followRef.current = true;
              scroller.current?.scrollToEnd({ animated: true });
              return;
            }
            // Growing while you're at the bottom — the reply revealing, an attachment bubble
            // appearing, a result card expanding. Follow it.
            if (followRef.current) scroller.current?.scrollToEnd({ animated: true });
          }}
        >
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
                Tell me what your family needs. I'll look things up, do them, and tell you what I did.
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
            if (m.role === "user") {
              // Handoff: user bubbles are fixed ink-navy in BOTH modes (18/18/4/18).
              return (
                <Animated.View key={m.id} entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)} style={{ alignItems: "flex-end", gap: 6 }}>
                  {/* L1 — "the way it was attached and previewed to me was just as text. It
                      needs to be a LIVE PREVIEW in the chat, just like any other chat interface
                      would have." The bubble carried the filename in square brackets, which is
                      a description of a photo rather than the photo. */}
                  {m.attachments?.length ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", maxWidth: "86%" }}>
                      {m.attachments.map((a) => (
                        <AttachmentTile key={a.key} name={a.name} uri={a.uri} mime={a.mime} size={92} />
                      ))}
                    </View>
                  ) : null}
                  {withoutAttachmentPrefix(m.text).trim() ? (
                    <View style={{ backgroundColor: "#2A3147", borderRadius: 18, borderBottomRightRadius: 4, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 10, maxWidth: "86%" }}>
                      {/* The "[Attached: …]" prefix is for the model, not for you — it's how the
                          server knows what rode along. With a real thumbnail above it, showing
                          it as well would be saying the same thing twice, worse. */}
                      <T selectable color="#F3EDE1">{withoutAttachmentPrefix(m.text)}</T>
                    </View>
                  ) : null}
                </Animated.View>
              );
            }
            return (
              <Animated.View
                key={m.id}
                entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)}
                style={{ alignItems: "flex-start" }}
                /* No onLayout scroll here any more: the reply's arrival is handled by the
                   follow rule on the scroll view (see followRef). Measuring from here fired
                   while the bubble was still empty, which is why it scrolled nowhere. */
              >
                <View style={{ maxWidth: "94%", alignSelf: "stretch", gap: spacing.sm }}>
                  {m.text.trim() ? (
                    <Card padded={false} style={{ padding: spacing.md, borderTopLeftRadius: 6, alignSelf: "flex-start", maxWidth: "100%" }}>
                      {m.error
                        ? <T selectable color={colors.coral}>{m.text}</T>
                        : <MarkdownText text={m.text} />}
                      {/* N1 — "these are links… they need to be displayed as cards, just like
                          throughout the app, within this actual chat bubble — individual ones,
                          so they're more structured, I can see them, I can click on them."
                          The prose stays: the sentence around a result is usually why that
                          result is there, and a list of cards can't say "the closest match is
                          X, though Y is cheaper". */}
                      {!m.error ? <LinkCards links={linksIn(m.text)} /> : null}
                    </Card>
                  ) : null}
                  {/* K2 — the rows the run fetched, as real cards, right here in the thread. */}
                  {m.resultGroups ? <ResultCards groups={m.resultGroups} /> : null}
                  {/* What the engine actually did this turn — small, muted, and honest about
                      the step that's still waiting on someone. */}
                  {m.toolCalls?.length ? <ToolCallsRow calls={m.toolCalls} /> : null}
                  {plan ? <PlanCard plan={plan} autoRun={!!m.runId} onRun={() => void runPlan(plan)} /> : null}
                </View>
              </Animated.View>
            );
          })}

          {/* Auto-executed server run: live step progress inline in the thread. */}
          {serverRun && msgs.length > 0 && !TERMINAL_RUN_STATUSES.includes(serverRun.status) ? (
            <Card style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <T kind="h3" color={colors.text} style={{ flex: 1 }}>{serverRun.title}</T>
                <Badge
                  label={PARKED_RUN_STATUSES.includes(serverRun.status) ? "Waiting for approval" : "Doing it"}
                  fg={PARKED_RUN_STATUSES.includes(serverRun.status) ? colors.amber : colors.ember}
                  bg={PARKED_RUN_STATUSES.includes(serverRun.status) ? colors.amberBg : colors.emberBg}
                />
              </View>
              {serverRun.steps.map((s, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: ["succeeded", "done", "completed"].includes(s.status) ? colors.sage
                      : s.status === "running" ? colors.ember
                      : s.status === "failed" ? colors.coral
                      : [...PARKED_RUN_STATUSES, "skipped_no_tool", "skipped", "expired"].includes(s.status) ? colors.amber
                      : colors.textFaint,
                  }} />
                  <View style={{ flex: 1 }}>
                    <T kind="sub" color={colors.textSecondary} numberOfLines={1}>{s.title}</T>
                    {/* WP-003/WP-004: a step that did not deliver says so RIGHT HERE, at
                        the same weight as the step title. Burying it — or leaving it as a
                        neutral grey dot — is how "3/3 finished" came to mean "nothing sent". */}
                    {["skipped_no_tool", "skipped", "expired"].includes(s.status) ? (
                      <T kind="sub" color={colors.amber} numberOfLines={2}>
                        {s.status === "skipped_no_tool" ? "Not sent — no delivery tool for this step"
                          : s.status === "expired" ? "Expired — nothing was sent"
                          : `Skipped — ${String(s.detail ?? "not permitted").replace(/^Not permitted:\s*/, "")}`}
                      </T>
                    ) : null}
                  </View>
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

          {busy ? <TypingBubble phase={phase} working={working} /> : null}
        </ScrollView>

        {/* Composer */}
        <View style={{ paddingBottom: composerPadBottom, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
          {/* One bubble per attachment, each showing its OWN state — spinner while it uploads,
              a tick when it's there, the reason on the bubble if it failed. "The loading sign
              needs to be on the individual item so you know which ones have fully loaded." */}
          {attached.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
              {attached.map((a) => {
                const tone = a.status === "failed" ? colors.coral : a.status === "ready" ? colors.sage : colors.textMuted;
                return (
                  <View
                    key={a.key}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 6,
                      backgroundColor: colors.surfaceSunken, borderRadius: 999,
                      paddingHorizontal: 12, paddingVertical: 6, maxWidth: "100%",
                      borderWidth: 1, borderColor: a.status === "failed" ? colors.coral : "transparent",
                    }}
                  >
                    {/* The thumbnail, not a paperclip: "I need to see a very small box that
                        depicts it… a miniature thumbnail of them, just like ChatGPT." */}
                    <AttachmentTile name={a.name} uri={a.uri} mime={a.mime} size={28} />
                    {a.status === "uploading"
                      ? <ActivityIndicator size="small" color={colors.textMuted} />
                      : a.status === "failed"
                        ? <Sym name="exclamationmark.triangle" size={12} color={tone} />
                        : null}
                    <T kind="subMedium" color={colors.textSecondary} numberOfLines={1} style={{ flexShrink: 1 }}>{a.name}</T>
                    {a.status === "failed" && a.error ? (
                      <T kind="caption" color={colors.coral} numberOfLines={1}>· {a.error}</T>
                    ) : null}
                    <PressableScale
                      onPress={() => setAttached((as) => as.filter((x) => x.key !== a.key))}
                      hitSlop={10} haptic="select"
                      accessibilityRole="button" accessibilityLabel={`Remove attachment ${a.name}`}
                    >
                      <Sym name="xmark" size={11} color={colors.textFaint} />
                    </PressableScale>
                  </View>
                );
              })}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
          <Coach id="ask.attach">
          <PressableScale
            onPress={pickAttachment}
            disabled={busy}
            haptic={null}
            accessibilityRole="button"
            accessibilityLabel="Attach a file"
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center",
              opacity: busy ? 0.45 : 1,
            }}
          >
            {/* Never a spinner: progress belongs on the individual bubbles above, and this
                button staying live is what lets you queue a second photo while the first
                uploads. */}
            <Sym name="plus" size={18} color={colors.textSecondary} />
          </PressableScale>
          </Coach>
          {/* M6 [06:03] — "if I start typing out a really long response this moves up to a
              certain height, but it needs to expand. I need to be able to drag it up or down."
              It grew to a fixed 120pt ceiling and stopped. Now the ceiling itself is
              draggable: pull the grabber up for room to write, push it back down when done. */}
          <Coach id="ask.composer" style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {composerMax > 120 || text.length > 80 ? (
              <GestureDetector gesture={composerDrag}>
                <View style={{ alignItems: "center", paddingVertical: 5 }} accessible accessibilityLabel="Drag to resize the message box">
                  <View style={{ width: 30, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
                </View>
              </GestureDetector>
            ) : null}
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              placeholder="Message Famili"
              placeholderTextColor={colors.textFaint}
              multiline
              accessibilityLabel="Message"
              style={{
                minHeight: 44, maxHeight: composerMax,
                backgroundColor: colors.surfaceSunken, borderRadius: 22, borderCurve: "continuous",
                paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
                ...type.body, color: colors.text,
              }}
            />
          </View>
          </Coach>
          <DictateButton
            listening={listening}
            onPress={() => void toggleDictation(text)}
            size={44}
          />
          <PressableScale
            onPress={() => void send()}
            disabled={(!text.trim() && !attached.some((a) => a.status === "ready" && a.id)) || busy}
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
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ------------------------------ pieces ------------------------------ */

function ConvChip({ label, icon = "bubble.left", dot, selected, onPress, onLongPress, hint }: {
  label: string; icon?: string; dot?: string; selected?: boolean; onPress?: () => void; onLongPress?: () => void; hint?: string;
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
      {dot ? (
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: selected ? colors.onEmber : dot }} />
      ) : (
        <Sym name={icon} size={12} color={selected ? colors.onEmber : colors.textFaint} />
      )}
      <T kind="subMedium" color={selected ? colors.onEmber : colors.textSecondary} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </T>
    </PressableScale>
  );
}

/* Said plainly, because the point is to be believed. "Searching the web" is a different
 * wait from "Thinking" — it is longer, it involves someone else's server, and knowing which
 * one you are in is the difference between waiting and giving up. */
const PHASE_LABEL: Record<AssistantPhase, string> = {
  thinking: "Thinking…",
  writing: "Writing…",
  searching: "Searching the web…",
  creating: "Setting that up…",
};

/** Three softly pulsing dots — the "assistant is working" bubble. `working` names the tool
 *  the server is calling right now, when it has said so. */
function TypingBubble({ phase, working }: { phase: AssistantPhase; working?: string | null }) {
  const { spacing } = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)} style={{ alignItems: "flex-start" }}>
      <Card padded={false} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 12, borderTopLeftRadius: 6 }}>
        <View style={{ flexDirection: "row", gap: 5 }}>
          <TypingDot delay={0} />
          <TypingDot delay={140} />
          <TypingDot delay={280} />
        </View>
        <T kind="caption">{working ? `Working: ${working}` : PHASE_LABEL[phase]}</T>
      </Card>
    </Animated.View>
  );
}

/** The turn's tool calls, as a receipt: a tick for what got done, a warning for what
 *  didn't, and the one that's waiting on a person tappable through to the Inbox. */
function ToolCallsRow({ calls }: { calls: AssistantToolCall[] }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: 4 }} accessibilityRole="list">
      {calls.map((c, i) => {
        const label = c.label || c.tool;
        if (c.status === "awaiting_approval") {
          return (
            <PressableScale
              key={i}
              onPress={() => router.push("/inbox")}
              haptic="select" hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${label} is waiting for approval. Open Inbox`}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Sym name="clock" size={10} color={colors.amber} />
              <T kind="caption" color={colors.amber}>Waiting for approval · {label}</T>
            </PressableScale>
          );
        }
        const failed = c.status === "failed" || c.status === "blocked" || c.ok === false;
        // A refusal carries its reason in `summary` ("Not permitted for this helper", the kill
        // switch). Show it, so a policy block reads differently from a crash.
        const reason = failed && typeof c.summary === "string" && c.summary.trim() ? c.summary.trim() : null;
        return (
          <View key={i} style={{ flexDirection: "row", alignItems: reason ? "flex-start" : "center", gap: 4, maxWidth: "100%" }} accessibilityLabel={`${label}: ${failed ? c.status : "done"}${reason ? `. ${reason}` : ""}`}>
            <Sym name={failed ? "exclamationmark.triangle" : "checkmark"} size={10} color={failed ? colors.coral : colors.textFaint} style={reason ? { marginTop: 3 } : undefined} />
            <View style={{ flexShrink: 1 }}>
              <T kind="caption" color={failed ? colors.coral : colors.textFaint}>{label}</T>
              {reason ? <T kind="detail" color={colors.textSecondary} numberOfLines={2}>{reason}</T> : null}
            </View>
          </View>
        );
      })}
    </View>
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
