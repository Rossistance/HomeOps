// One message in a family thread. Mine on the right in ember, theirs on the left with the
// sender's colour; photos inline, files as tiles, shared things as cards, voice notes with a
// player; reactions as small pills under the bubble; "edited" and "Message deleted" said
// plainly. Suggestions sit in a narrow rail BESIDE the bubble (never inside it), so the
// message column never shifts.
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { MessageAttachment, MessageRec, ThreadMemberRec } from "@/lib/api";
import { useFileDataUri } from "@/lib/file-data";
import { memberAccent, fade } from "@/lib/member-colors";
import { useTheme } from "@/theme";
import { T, Sym, PressableScale } from "@/components/ui";
import { ShareCard } from "./share-card";
import { VoiceNote } from "./voice-note";
import { SuggestionRail } from "./suggestion-rail";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function ImageAttachment({ fileId, mine }: { fileId: string; mine: boolean }) {
  const uri = useFileDataUri(fileId);
  const [full, setFull] = useState(false);
  const { colors } = useTheme();
  return (
    <>
      <Pressable onPress={() => uri && setFull(true)} accessibilityRole="imagebutton" accessibilityLabel="Photo, tap to view">
        <View style={{ width: 220, height: 165, borderRadius: 12, overflow: "hidden", backgroundColor: mine ? "rgba(255,255,255,0.15)" : colors.surfaceSunken }}>
          {uri ? <Image source={{ uri }} style={{ width: 220, height: 165 }} contentFit="cover" transition={150} /> : null}
        </View>
      </Pressable>
      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <Pressable onPress={() => setFull(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" }}>
          {uri ? <Image source={{ uri }} style={{ width: "100%", height: "80%" }} contentFit="contain" /> : null}
          <T kind="caption" color="#fff" style={{ marginTop: 12 }}>Tap to close</T>
        </Pressable>
      </Modal>
    </>
  );
}

function FileAttachment({ a, mine }: { a: Extract<MessageAttachment, { kind: "file" }>; mine: boolean }) {
  const { colors, spacing, radii } = useTheme();
  const fg = mine ? colors.onEmber : colors.text;
  return (
    <PressableScale
      onPress={() => router.push({ pathname: "/(library)" as never, params: { file: a.fileId } } as never)}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={`Open file ${a.name ?? ""}`}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, borderWidth: 1, borderColor: mine ? "rgba(255,255,255,0.28)" : colors.border }}
    >
      <Sym name="doc" size={18} color={fg} />
      <T kind="subMedium" color={fg} style={{ flex: 1 }} numberOfLines={2}>{a.name ?? "File"}</T>
    </PressableScale>
  );
}

export function MessageBubble({ m, mine, sender, showName, receipt, threadId, meActorId, onLongPress, onSuggestionDone }: {
  m: MessageRec;
  mine: boolean;
  sender: ThreadMemberRec | null;
  showName: boolean;
  /** "Seen" / "Seen by Melissa, GPop" — only on the last message each reader passed. */
  receipt: string | null;
  threadId: string;
  meActorId: string | null;
  onLongPress: (m: MessageRec) => void;
  onSuggestionDone: () => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const accent = memberAccent(colors, sender?.color ?? null) ?? colors.sky;
  const bg = mine ? colors.ember : fade(accent, 0.14);
  const fg = mine ? colors.onEmber : colors.text;
  const muted = mine ? "rgba(255,255,255,0.75)" : colors.textMuted;
  const reactions = Object.entries(m.reactions ?? {}).filter(([, who]) => who.length);
  const openSuggestions = (m.suggestions ?? []).filter((s) => s.status === "open");

  if (m.kind === "system") {
    return (
      <View style={{ alignItems: "center", paddingVertical: 4 }}>
        <T kind="caption" color={colors.textFaint} center>{m.text}</T>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-end", gap: 6, paddingVertical: 3 }}>
      <View style={{ maxWidth: "78%", alignItems: mine ? "flex-end" : "flex-start" }}>
        {showName && !mine ? <T kind="caption" color={accent} style={{ marginLeft: 6, marginBottom: 2 }}>{sender?.displayName?.split(" ")[0] ?? "Someone"}</T> : null}
        <Pressable
          onLongPress={() => onLongPress(m)}
          delayLongPress={280}
          accessibilityRole="text"
          accessibilityLabel={`${mine ? "You" : sender?.displayName ?? "Someone"}: ${m.deletedAt ? "message deleted" : m.text}`}
          style={{
            backgroundColor: bg, borderRadius: radii.row, paddingHorizontal: 12, paddingVertical: 8, gap: 6,
            borderBottomRightRadius: mine ? 4 : radii.row, borderBottomLeftRadius: mine ? radii.row : 4,
          }}
        >
          {m.deletedAt ? (
            <T kind="sub" color={muted} style={{ fontStyle: "italic" }}>Message deleted</T>
          ) : (
            <>
              {(m.attachments ?? []).map((a, i) => {
                if (a.kind === "ref") return <ShareCard key={i} type={a.type} preview={a.preview} mine={mine} />;
                if (a.audio) return <VoiceNote key={i} fileId={a.fileId} durationMs={a.audio.durationMs} mine={mine} transcript={a.transcript ?? null} />;
                if (/^image\//.test(a.mime ?? "")) return <ImageAttachment key={i} fileId={a.fileId} mine={mine} />;
                return <FileAttachment key={i} a={a} mine={mine} />;
              })}
              {m.text ? <T kind="body" color={fg} selectable>{m.text}</T> : null}
            </>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end" }}>
            {m.editedAt && !m.deletedAt ? <T kind="caption" color={muted}>edited ·</T> : null}
            <T kind="caption" color={muted}>{timeOf(m.at)}</T>
          </View>
        </Pressable>
        {reactions.length ? (
          <View style={{ flexDirection: "row", gap: 4, marginTop: -6, marginHorizontal: 6 }}>
            {reactions.map(([emoji, who]) => (
              <View key={emoji} style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: who.includes(meActorId ?? "") ? colors.ember : colors.border }}>
                <T kind="caption">{emoji}</T>
                {who.length > 1 ? <T kind="caption" color={colors.textMuted}>{who.length}</T> : null}
              </View>
            ))}
          </View>
        ) : null}
        {receipt ? <T kind="caption" color={colors.textFaint} style={{ marginTop: 2, marginHorizontal: 6 }}>{receipt}</T> : null}
      </View>
      {/* The rail: suggestions live beside the bubble, out of the way of the words. */}
      {openSuggestions.length ? (
        <SuggestionRail threadId={threadId} message={m} suggestions={openSuggestions} onDone={onSuggestionDone} />
      ) : null}
      <View style={{ width: spacing.sm }} />
    </View>
  );
}
