// A voice note in a bubble: play/pause, a progress bar you can scrub, the length, and the
// transcript when the server produced one. Bytes come through the same file cache as photos.
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useFileDataUri } from "@/lib/file-data";
import { formatDuration } from "@/lib/messages";
import { useTheme } from "@/theme";
import { T, Sym } from "@/components/ui";

export function VoiceNote({ fileId, durationMs, mine, transcript }: { fileId: string; durationMs: number; mine: boolean; transcript: string | null }) {
  const { colors, spacing } = useTheme();
  const uri = useFileDataUri(fileId);
  const source = useMemo(() => (uri ? { uri } : null), [uri]);
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const [showText, setShowText] = useState(false);
  const fg = mine ? colors.onEmber : colors.text;
  const muted = mine ? "rgba(255,255,255,0.75)" : colors.textMuted;
  const total = (status.duration && status.duration > 0 ? status.duration * 1000 : durationMs) || 1;
  const pos = Math.min(1, (status.currentTime ?? 0) * 1000 / total);

  useEffect(() => {
    // Back to the start when it finishes, so the next tap plays again rather than doing nothing.
    if (status.didJustFinish) { player.pause(); void player.seekTo(0); }
  }, [status.didJustFinish, player]);

  return (
    <View style={{ gap: 4, minWidth: 200 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Pressable
          onPress={() => { if (!uri) return; if (status.playing) player.pause(); else player.play(); }}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? "Pause voice note" : "Play voice note"}
          style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: mine ? "rgba(255,255,255,0.18)" : colors.surface }}
        >
          <Sym name={status.playing ? "pause.fill" : "play.fill"} size={14} color={fg} />
        </Pressable>
        <Pressable
          onPress={(e) => { const w = 120; const x = Math.max(0, Math.min(w, e.nativeEvent.locationX)); void player.seekTo((x / w) * (total / 1000)); }}
          accessibilityRole="adjustable"
          accessibilityLabel="Voice note position"
          style={{ width: 120, height: 20, justifyContent: "center" }}
        >
          <View style={{ height: 4, borderRadius: 2, backgroundColor: mine ? "rgba(255,255,255,0.3)" : colors.border }}>
            <View style={{ width: `${Math.round(pos * 100)}%`, height: 4, borderRadius: 2, backgroundColor: fg }} />
          </View>
        </Pressable>
        <T kind="caption" color={muted}>{formatDuration(status.playing || pos > 0 ? (status.currentTime ?? 0) * 1000 : durationMs)}</T>
      </View>
      {transcript ? (
        <Pressable onPress={() => setShowText((v) => !v)} accessibilityRole="button" accessibilityLabel={showText ? "Hide transcript" : "Show transcript"}>
          <T kind="caption" color={muted} numberOfLines={showText ? undefined : 1}>{showText ? transcript : `“${transcript}”`}</T>
        </Pressable>
      ) : null}
    </View>
  );
}
