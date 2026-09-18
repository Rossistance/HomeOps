// A family thread. Bubbles newest at the bottom with day separators, receipts under the last
// message each reader passed, a typing line, and a composer with photos, camera, files and a
// hold-to-record voice note. The ⋯ menu: add people, mute, rename, search in this chat,
// remove someone, leave. Long-press a bubble to react, edit or delete.
//
// Freshness is a 4-second poll while the screen is focused (the server's revision counter
// feeds the lists; a thread you are looking at deserves faster than that), plus the push.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { api, type MessageAttachment, type MessageRec, type ThreadRec, type ThreadView } from "@/lib/api";
import { useSession } from "@/lib/session";
import { groupByDay, dayLabel, threadTitle, receiptsFor, formatDuration } from "@/lib/messages";
import { pickDocument, pickPhotos, uploadVoiceNote } from "@/lib/message-attachments";
import { useTheme, tapHaptic } from "@/theme";
import { T, Sym, HSheet, Row, Card, PressableScale, Button } from "@/components/ui";
import { MessageBubble } from "@/components/messages/bubble";
import { AvatarStack } from "@/components/messages/thread-list";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const PARENT = new Set(["Owner", "Adult Admin"]);
type Item = { key: string; kind: "day"; label: string } | { key: string; kind: "msg"; m: MessageRec; showName: boolean };

export default function ThreadScreen() {
  const { session } = useSession();
  const { colors, spacing, radii, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; jump?: string }>();
  const id = String(params.id);
  const me = session?.actorId ?? null;

  const [view, setView] = useState<ThreadView | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string[]>([]); // attachments being uploaded, by label
  const [longPressed, setLongPressed] = useState<MessageRec | null>(null);
  const [editing, setEditing] = useState<MessageRec | null>(null);
  const [menu, setMenu] = useState(false);
  const [muteSheet, setMuteSheet] = useState(false);
  const [removeSheet, setRemoveSheet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState<string | null>(typeof params.jump === "string" ? params.jump : null);
  const list = useRef<FlatList<Item>>(null);
  const lastTyping = useRef(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    const v = await api.thread(id);
    if (!v) { setMissing(true); return; }
    setView(v);
  }, [id]);

  // Poll while focused; mark read on open and whenever new messages land while open.
  useFocusEffect(useCallback(() => {
    let alive = true;
    void load().then(() => { if (alive) void api.markThreadRead(id); });
    const t = setInterval(() => { if (alive) void load(); }, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [load, id]));
  const lastCount = useRef(0);
  useEffect(() => {
    const n = view?.messages.length ?? 0;
    if (n > lastCount.current && lastCount.current > 0) void api.markThreadRead(id);
    lastCount.current = n;
  }, [view?.messages.length, id]);

  const thread = view?.thread ?? null;
  const members = useMemo(() => new Map((thread?.members ?? []).map((m) => [m.actorId, m])), [thread]);
  const receipts = useMemo(() => (view ? receiptsFor(view.messages, view.readBy, me) : {}), [view, me]);
  const canPost = !!thread && !thread.left && !thread.archived && thread.participantIds.includes(me ?? "");
  const myRole = session?.role ?? null;
  const isGroup = thread?.kind === "group";
  const active = (thread?.members ?? []).filter((m) => !m.leftAt);
  const participantIds = thread?.participantIds ?? [];

  // Inverted list: newest first in data, rendered bottom-up.
  const items = useMemo<Item[]>(() => {
    if (!view) return [];
    const out: Item[] = [];
    for (const day of groupByDay(view.messages)) {
      out.push({ key: `day:${day.day}`, kind: "day", label: dayLabel(day.day) });
      day.items.forEach((m, i) => {
        const prev = day.items[i - 1];
        const showName = !!isGroup && (!prev || prev.fromActorId !== m.fromActorId || prev.kind === "system");
        out.push({ key: m.id, kind: "msg", m, showName });
      });
    }
    return out.reverse();
  }, [view, isGroup]);

  // Jump to a search hit once it is in the list.
  useEffect(() => {
    if (!highlight || !items.length) return;
    const idx = items.findIndex((x) => x.kind === "msg" && x.m.id === highlight);
    if (idx >= 0) {
      setTimeout(() => list.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }), 150);
      setTimeout(() => setHighlight(null), 2500);
    }
  }, [highlight, items]);

  const onChangeText = (t: string) => {
    setText(t);
    const now = Date.now();
    if (t && now - lastTyping.current > 3000) { lastTyping.current = now; void api.typing(id); }
  };

  async function send(attachments: MessageAttachment[] = []) {
    const body = text.trim();
    if (!body && attachments.length === 0) return;
    if (editing) {
      setSending(true);
      const r = await api.editMessage(id, editing.id, body);
      setSending(false);
      if (r.error) { tapHaptic("error"); Alert.alert("Couldn't edit", r.error); return; }
      setEditing(null); setText(""); await load(); return;
    }
    setSending(true);
    setText("");
    const r = await api.sendMessage(id, { text: body, attachments });
    setSending(false);
    if (r.error && r.error !== "queued_offline") { tapHaptic("error"); setText(body); Alert.alert("Couldn't send", r.error); return; }
    tapHaptic("light");
    await load();
    void api.markThreadRead(id);
  }

  async function attach(kind: "photos" | "camera" | "document") {
    const label = kind === "document" ? "file" : "photo";
    setPending((p) => [...p, label]);
    try {
      const atts = kind === "document" ? [await pickDocument(participantIds)].filter(Boolean) as MessageAttachment[] : (await pickPhotos(kind === "camera", participantIds)) ?? [];
      if (atts.length) await send(atts);
    } catch (e) {
      tapHaptic("error");
      Alert.alert("Couldn't attach that", String((e as Error)?.message ?? e));
    } finally {
      setPending((p) => { const i = p.indexOf(label); return i < 0 ? p : [...p.slice(0, i), ...p.slice(i + 1)]; });
    }
  }

  async function startRecording() {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { Alert.alert("Microphone", "Allow microphone access to record a voice note."); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
    tapHaptic("light");
  }
  async function stopRecording(cancel = false) {
    if (!recording) return;
    setRecording(false);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    const uri = recorder.uri;
    const durationMs = rec.durationMillis;
    if (cancel || !uri || durationMs < 700) return;
    setPending((p) => [...p, "voice note"]);
    try {
      const att = await uploadVoiceNote(uri, durationMs, participantIds);
      await send([att]);
    } catch (e) {
      tapHaptic("error");
      Alert.alert("Couldn't send the voice note", String((e as Error)?.message ?? e));
    } finally {
      setPending((p) => p.filter((x) => x !== "voice note"));
    }
  }

  async function react(emoji: string) {
    if (!longPressed) return;
    setLongPressed(null);
    await api.reactToMessage(id, longPressed.id, emoji);
    await load();
  }
  function confirmDelete(m: MessageRec) {
    setLongPressed(null);
    Alert.alert("Delete this message?", "It becomes “Message deleted” for everyone in the chat.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void api.deleteMessage(id, m.id).then(load) },
    ]);
  }
  async function mute(until: string | null) {
    setMuteSheet(false);
    const t = await api.muteThread(id, until);
    if (t) { tapHaptic("success"); await load(); }
  }
  function rename() {
    if (!thread) return;
    Alert.prompt("Name this group", "Everyone in the chat sees the name.", async (name) => {
      const r = await api.renameThread(id, name ?? "");
      if (r.error) Alert.alert("Couldn't rename", r.error); else await load();
    }, "plain-text", thread.title ?? "");
  }
  function leave() {
    Alert.alert("Leave this chat?", "You'll keep what was said until now and stop getting new messages.", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => void api.leaveThread(id).then(() => router.back()) },
    ]);
  }
  async function remove(actorId: string) {
    setRemoveSheet(false);
    const r = await api.removeThreadMember(id, actorId);
    if (r.error) { tapHaptic("error"); Alert.alert("Couldn't remove them", r.message ?? r.error); } else { tapHaptic("success"); await load(); }
  }

  const canRemove = !!thread && (PARENT.has(myRole ?? "") || thread.createdBy === me) && active.length > 2;
  const searchHits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!view || needle.length < 2) return [];
    return view.messages.filter((m) => !m.deletedAt && m.text.toLowerCase().includes(needle)).slice(-30).reverse();
  }, [q, view]);
  const typingNames = (view?.typing ?? []).map((a) => members.get(a)?.displayName.split(" ")[0] ?? "Someone");

  const title = thread ? threadTitle(thread, me) : "Messages";
  const header = (
    <Stack.Screen
      options={{
        title,
        headerLargeTitle: false,
        headerRight: thread ? () => (
          <PressableScale onPress={() => setMenu(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Chat options" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}>
            <Sym name="ellipsis" size={16} color={colors.ember} />
          </PressableScale>
        ) : undefined,
      }}
    />
  );

  if (missing) {
    return (
      <>{header}<View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md }}>
        <Sym name="bubble.left.and.exclamationmark.bubble.right" size={28} color={colors.textFaint} />
        <T kind="sub" center>This chat isn't available to you.</T>
        <Button title="Back to Inbox" onPress={() => router.replace({ pathname: "/inbox", params: { seg: "messages" } } as never)} />
      </View></>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={insets.top + 44}>
        {/* Participants strip under the header. */}
        {thread ? (
          <Pressable onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel="Participants" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: insets.top + 44 + 6, paddingBottom: 6 }}>
            <AvatarStack t={thread} meActorId={me} size={26} />
            <T kind="caption" color={colors.textMuted} style={{ flex: 1 }} numberOfLines={1}>
              {active.map((m) => (m.actorId === me ? "You" : m.displayName.split(" ")[0])).join(", ")}{thread.muted ? " · muted" : ""}
            </T>
            {thread.left ? <T kind="caption" color={colors.coral}>You left</T> : null}
          </Pressable>
        ) : null}

        {!view ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.ember} /></View>
        ) : (
          <FlatList
            ref={list}
            inverted
            data={items}
            keyExtractor={(x) => x.key}
            contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
            keyboardDismissMode="interactive"
            onScrollToIndexFailed={() => { /* the hit is older than the loaded page; nothing to jump to */ }}
            renderItem={({ item }) => item.kind === "day" ? (
              <View style={{ alignItems: "center", paddingVertical: 8 }}>
                <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: colors.surfaceSunken }}>
                  <T kind="caption" color={colors.textMuted}>{item.label}</T>
                </View>
              </View>
            ) : (
              <View style={highlight === item.m.id ? { backgroundColor: colors.amberBg, borderRadius: radii.row } : undefined}>
                <MessageBubble
                  m={item.m}
                  mine={item.m.fromActorId === me}
                  sender={members.get(item.m.fromActorId) ?? null}
                  showName={item.showName}
                  receipt={receipts[item.m.id]?.length ? (isGroup ? `Seen by ${receipts[item.m.id].map((a) => members.get(a)?.displayName.split(" ")[0] ?? "someone").join(", ")}` : "Seen") : null}
                  threadId={id}
                  meActorId={me}
                  onLongPress={(m) => { if (!m.deletedAt && canPost) { tapHaptic("select"); setLongPressed(m); } }}
                  onSuggestionDone={() => void load()}
                />
              </View>
            )}
            ListHeaderComponent={typingNames.length || pending.length ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 4, gap: 2 }}>
                {typingNames.length ? <T kind="caption" color={colors.textMuted}>{typingNames.join(", ")} {typingNames.length > 1 ? "are" : "is"} typing…</T> : null}
                {pending.map((p, i) => <T key={`${p}${i}`} kind="caption" color={colors.textMuted}>Sending {p}…</T>)}
              </View>
            ) : null}
            ListEmptyComponent={<View style={{ alignItems: "center", padding: spacing.xl }}><T kind="sub" center>Say hello — this is the start of the conversation.</T></View>}
          />
        )}

        {/* Composer */}
        {canPost ? (
          <View style={{ paddingHorizontal: spacing.md, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) + 4, gap: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
            {editing ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Sym name="pencil" size={12} color={colors.ember} />
                <T kind="caption" color={colors.ember} style={{ flex: 1 }}>Editing</T>
                <PressableScale onPress={() => { setEditing(null); setText(""); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel editing"><Sym name="xmark" size={12} color={colors.textMuted} /></PressableScale>
              </View>
            ) : null}
            {recording ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.coralBg }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral }} />
                <T kind="subMedium" color={colors.coral} style={{ flex: 1 }}>Recording {formatDuration(rec.durationMillis)}</T>
                <Button title="Cancel" small variant="ghost" onPress={() => void stopRecording(true)} />
                <Button title="Send" small variant="ember" icon="paperplane" onPress={() => void stopRecording(false)} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
                <PressableScale
                  onPress={() => Alert.alert("Attach", undefined, [
                    { text: "Photo library", onPress: () => void attach("photos") },
                    { text: "Camera", onPress: () => void attach("camera") },
                    { text: "File", onPress: () => void attach("document") },
                    { text: "Cancel", style: "cancel" },
                  ])}
                  hitSlop={8} accessibilityRole="button" accessibilityLabel="Attach a photo or file"
                  style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSunken }}
                >
                  <Sym name="plus" size={16} color={colors.textSecondary} />
                </PressableScale>
                <TextInput
                  value={text}
                  onChangeText={onChangeText}
                  placeholder={isGroup ? `Message ${title}` : `Message ${title}`}
                  placeholderTextColor={colors.textFaint}
                  multiline
                  maxLength={4000}
                  accessibilityLabel="Message"
                  style={{ flex: 1, minHeight: 38, maxHeight: 140, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 19, backgroundColor: colors.surfaceSunken, color: colors.text, fontSize: 16, borderWidth: 1, borderColor: dark ? colors.rim : colors.border }}
                />
                {text.trim() ? (
                  <PressableScale onPress={() => void send()} disabled={sending} hitSlop={8} accessibilityRole="button" accessibilityLabel={editing ? "Save edit" : "Send"} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.ember }}>
                    {sending ? <ActivityIndicator color={colors.onEmber} size="small" /> : <Sym name={editing ? "checkmark" : "arrow.up"} size={16} color={colors.onEmber} />}
                  </PressableScale>
                ) : (
                  <PressableScale onPress={() => void startRecording()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Record a voice note" style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSunken }}>
                    <Sym name="mic" size={16} color={colors.textSecondary} />
                  </PressableScale>
                )}
              </View>
            )}
          </View>
        ) : thread ? (
          <View style={{ padding: spacing.md, paddingBottom: Math.max(insets.bottom, 8) + 4, alignItems: "center" }}>
            <T kind="caption" color={colors.textMuted}>{thread.left ? "You're no longer in this chat." : "You can read this chat but not post in it."}</T>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* Long-press: react / edit / delete */}
      <HSheet visible={!!longPressed} onClose={() => setLongPressed(null)} title="Message" heightPct={0.42}>
        {longPressed ? (
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {EMOJIS.map((e) => (
                <PressableScale key={e} onPress={() => void react(e)} haptic="light" accessibilityRole="button" accessibilityLabel={`React ${e}`} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: (longPressed.reactions?.[e] ?? []).includes(me ?? "") ? colors.emberBg : colors.surfaceSunken }}>
                  <T style={{ fontSize: 24 }}>{e}</T>
                </PressableScale>
              ))}
            </View>
            <Card padded={false}>
              {longPressed.fromActorId === me && longPressed.kind === "text" && longPressed.text ? (
                <Row icon="pencil" title="Edit" onPress={() => { setEditing(longPressed); setText(longPressed.text); setLongPressed(null); }} />
              ) : null}
              {(longPressed.fromActorId === me || PARENT.has(myRole ?? "")) ? (
                <Row icon="trash" iconColor={colors.coral} iconBg={colors.coralBg} title="Delete" onPress={() => confirmDelete(longPressed)} last />
              ) : null}
            </Card>
          </View>
        ) : null}
      </HSheet>

      {/* ⋯ menu */}
      <HSheet visible={menu} onClose={() => setMenu(false)} title={title} heightPct={0.7}>
        {thread ? (
          <View style={{ gap: spacing.md }}>
            <Card padded={false}>
              {active.map((m, i) => (
                <Row key={m.actorId} title={m.actorId === me ? `${m.displayName} (you)` : m.displayName} subtitle={m.role ?? undefined} last={i === active.length - 1} />
              ))}
            </Card>
            <Card padded={false}>
              {canPost && !["Child View", "Limited Member"].includes(myRole ?? "") ? <Row icon="person.badge.plus" title="Add people" chevron onPress={() => { setMenu(false); router.push({ pathname: "/messages/new", params: { threadId: id } } as never); }} /> : null}
              <Row icon={thread.muted ? "bell" : "bell.slash"} title={thread.muted ? "Unmute" : "Mute"} chevron onPress={() => { setMenu(false); if (thread.muted) void mute(null); else setMuteSheet(true); }} />
              <Row icon="magnifyingglass" title="Search in this chat" chevron onPress={() => { setMenu(false); setSearchOpen(true); }} />
              {isGroup && canPost ? <Row icon="textformat" title="Rename group" chevron onPress={() => { setMenu(false); rename(); }} /> : null}
              {canRemove ? <Row icon="person.badge.minus" title="Remove someone" chevron onPress={() => { setMenu(false); setRemoveSheet(true); }} /> : null}
              {canPost ? <Row icon="rectangle.portrait.and.arrow.right" iconColor={colors.coral} iconBg={colors.coralBg} title="Leave chat" onPress={() => { setMenu(false); leave(); }} last /> : null}
            </Card>
          </View>
        ) : null}
      </HSheet>

      <HSheet visible={muteSheet} onClose={() => setMuteSheet(false)} title="Mute this chat" heightPct={0.42}>
        <T kind="sub" style={{ marginBottom: spacing.md }}>Messages still arrive and count as unread; your phone just stays quiet.</T>
        <Card padded={false}>
          <Row title="For 8 hours" onPress={() => void mute(new Date(Date.now() + 8 * 3600_000).toISOString())} />
          <Row title="Until tomorrow" onPress={() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); void mute(d.toISOString()); }} />
          <Row title="Until I turn it back on" onPress={() => void mute("forever")} last />
        </Card>
      </HSheet>

      <HSheet visible={removeSheet} onClose={() => setRemoveSheet(false)} title="Remove from chat" heightPct={0.5}>
        <Card padded={false}>
          {active.filter((m) => m.actorId !== me).map((m, i, arr) => (
            <Row key={m.actorId} title={m.displayName} subtitle={m.role ?? undefined} trailing={<Sym name="minus.circle" size={18} color={colors.coral} />} onPress={() => void remove(m.actorId)} last={i === arr.length - 1} />
          ))}
        </Card>
      </HSheet>

      <HSheet visible={searchOpen} onClose={() => { setSearchOpen(false); setQ(""); }} title="Search in this chat" heightPct={0.7}>
        <TextInput value={q} onChangeText={setQ} placeholder="Find a message" placeholderTextColor={colors.textFaint} autoFocus accessibilityLabel="Find a message"
          style={{ height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: colors.surfaceSunken, color: colors.text, fontSize: 16, marginBottom: spacing.md }} />
        {searchHits.length ? (
          <Card padded={false}>
            {searchHits.map((m, i) => (
              <Row key={m.id} title={m.text.length > 90 ? `${m.text.slice(0, 87)}…` : m.text} subtitle={`${members.get(m.fromActorId)?.displayName.split(" ")[0] ?? ""} · ${new Date(m.at).toLocaleDateString()}`} onPress={() => { setSearchOpen(false); setQ(""); setHighlight(m.id); }} last={i === searchHits.length - 1} />
            ))}
          </Card>
        ) : q.trim().length >= 2 ? <T kind="sub" center>No matches in the loaded messages.</T> : null}
      </HSheet>
    </View>
  );
}
