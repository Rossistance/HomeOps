// My Profile — every role can edit their own display name, accent color, and
// avatar (a curated emoji, an uploaded photo, or plain initials). Saves through
// api.patchMember (self-edits are allowed for everyone; the server enforces it).
// Also exports MemberAvatar — the shared avatar circle (photo/emoji/initials with
// a member-color ring) used on Today's strip and the scoped home headers.
import { useCallback, useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { api, type MemberRec } from "@/lib/api";
import { fade, memberAccent, memberColor } from "@/lib/member-colors";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import {
  T, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, PressableScale, Button, Notice, Well,
} from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Shared avatar circle: photoFileId "emoji:🦊" → emoji, a file id →   */
/* the fetched photo, else initials — always ringed in the member's    */
/* accent color so people are color-consistent across the app.         */
/* ------------------------------------------------------------------ */

// Fetched photo data-URIs, keyed by file id — avatars repeat a lot (Today strip,
// headers), so never fetch the same blob twice per app session.
const photoCache = new Map<string, string>();

export function MemberAvatar({ member, size = 40, ringWidth = 2 }: {
  member: MemberRec | null | undefined;
  size?: number;
  ringWidth?: number;
}) {
  const { colors } = useTheme();
  const accent = memberColor(colors, member) ?? colors.ember;
  const pid = member?.photoFileId ?? null;
  const emoji = pid?.startsWith("emoji:") ? pid.slice("emoji:".length) : null;
  const fileId = pid && !emoji ? pid : null;
  const [uri, setUri] = useState<string | null>(fileId ? photoCache.get(fileId) ?? null : null);

  useEffect(() => {
    if (!fileId) { setUri(null); return; }
    const cached = photoCache.get(fileId);
    if (cached) { setUri(cached); return; }
    let cancelled = false;
    void api.fileContent(fileId).then((r) => {
      if (cancelled || !r.contentBase64) return;
      const dataUri = `data:${r.mime ?? "image/jpeg"};base64,${r.contentBase64}`;
      photoCache.set(fileId, dataUri);
      setUri(dataUri);
    });
    return () => { cancelled = true; };
  }, [fileId]);

  const initials = (member?.displayName ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      borderWidth: ringWidth, borderColor: accent,
      backgroundColor: fade(accent, 0.16),
      alignItems: "center", justifyContent: "center", overflow: "hidden",
    }}>
      {fileId && uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" />
      ) : emoji ? (
        <T style={{ fontSize: size * 0.52, lineHeight: size * 0.66 }}>{emoji}</T>
      ) : (
        <T kind="subMedium" color={accent} style={{ fontWeight: "600", fontSize: Math.max(11, size * 0.32) }}>{initials}</T>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* The editor screen                                                    */
/* ------------------------------------------------------------------ */

const ACCENTS = ["ink", "sage", "coral", "amber", "sky", "lavender"] as const;
const EMOJIS = ["🦊", "🐻", "🦉", "🐙", "🌻", "🍀", "⭐️", "🌈", "🐝", "🦋", "🍕", "⚽️"] as const;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export default function ProfileScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const [me, setMe] = useState<MemberRec | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [photoFileId, setPhotoFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void api.members().then((ms) => {
      if (cancelled) return;
      const m = ms.find((x) => x.isCurrentUser) ?? ms.find((x) => x.actorId === session.actorId) ?? null;
      setMe(m);
      if (m) { setName(m.displayName); setColor(m.color ?? null); setPhotoFileId(m.photoFileId ?? null); }
    });
    return () => { cancelled = true; };
  }, [session?.actorId]);

  const pickPhoto = useCallback(async () => {
    setNote(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setNote({ text: "Photo library access was denied.", ok: false }); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], base64: true, quality: 0.7, allowsEditing: true, aspect: [1, 1],
    });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const a = res.assets[0];
    if (a.base64!.length * 0.75 > MAX_PHOTO_BYTES) { setNote({ text: "That photo is over the 5 MB cap.", ok: false }); return; }
    setUploading(true);
    const r = await api.uploadFile({
      name: a.fileName ?? `avatar-${Date.now()}.jpg`,
      contentBase64: a.base64!,
      mime: a.mimeType ?? "image/jpeg",
      visibility: "private",
    });
    setUploading(false);
    if (!r.file) { setNote({ text: `Couldn't upload that photo: ${r.message ?? r.error ?? "unknown error"}`, ok: false }); return; }
    setPhotoFileId(r.file.id);
  }, []);

  const save = useCallback(async () => {
    if (!session || busy) return;
    const displayName = name.trim();
    if (!displayName) { setNote({ text: "Your name can't be empty.", ok: false }); return; }
    setBusy(true); setNote(null);
    const r = await api.patchMember(session.actorId, { displayName, color, photoFileId });
    setBusy(false);
    if (!r.member) {
      setNote({ text: `Couldn't save: ${r.message ?? r.error ?? "unknown error"}`, ok: false });
      return;
    }
    tapHaptic("success");
    router.back();
  }, [session, busy, name, color, photoFileId]);

  if (!me) {
    return <HScreen><SkeletonCards count={3} /></HScreen>;
  }

  // Live preview member: whatever is currently picked, not yet saved.
  const preview: MemberRec = { ...me, displayName: name || me.displayName, color, photoFileId };
  const previewAccent = memberColor(colors, preview) ?? colors.ember;
  const currentEmoji = photoFileId?.startsWith("emoji:") ? photoFileId.slice("emoji:".length) : null;
  const hasPhoto = !!photoFileId && !currentEmoji;

  return (
    <HScreen>
      {note ? <Notice text={note.text} ok={note.ok} /> : null}

      {/* Live preview */}
      <Rise index={0}>
        <View style={{ alignItems: "center", gap: 10, marginTop: spacing.sm }}>
          <MemberAvatar member={preview} size={84} ringWidth={3} />
          <T kind="h2" center>{name || me.displayName}</T>
          <T kind="detail" center>{me.role}{me.relationship ? ` · ${me.relationship}` : ""}</T>
        </View>
      </Rise>

      {/* Name */}
      <Rise index={1}>
        <SectionHeader title="Your name" />
        <Well style={{ padding: 0 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="words"
            style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
            accessibilityLabel="Display name"
          />
        </Well>
      </Rise>

      {/* Color */}
      <Rise index={2}>
        <SectionHeader title="Your color" />
        <Card>
          <View style={{ flexDirection: "row", gap: spacing.md, flexWrap: "wrap" }}>
            {ACCENTS.map((a) => {
              const c = memberAccent(colors, a) ?? colors.ember;
              const selected = color === a;
              return (
                <PressableScale
                  key={a}
                  haptic="select"
                  onPress={() => setColor(a)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Color ${a}`}
                  style={{
                    width: 40, height: 40, borderRadius: 20,
                    alignItems: "center", justifyContent: "center",
                    borderWidth: selected ? 3 : 0, borderColor: colors.text,
                  }}
                >
                  <View style={{ width: selected ? 28 : 34, height: selected ? 28 : 34, borderRadius: 17, backgroundColor: c }} />
                </PressableScale>
              );
            })}
          </View>
        </Card>
      </Rise>

      {/* Avatar */}
      <Rise index={3}>
        <SectionHeader title="Your avatar" />
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
            {EMOJIS.map((e) => {
              const selected = currentEmoji === e;
              return (
                <PressableScale
                  key={e}
                  haptic="select"
                  onPress={() => setPhotoFileId(selected ? null : `emoji:${e}`)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Avatar ${e}`}
                  style={{
                    width: 46, height: 46, borderRadius: 23,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: selected ? fade(previewAccent, 0.18) : colors.surfaceSunken,
                    borderWidth: selected ? 2 : 0, borderColor: previewAccent,
                  }}
                >
                  <T style={{ fontSize: 22, lineHeight: 28 }}>{e}</T>
                </PressableScale>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Button
                small
                variant={hasPhoto ? "neutral" : "neutral"}
                icon="photo"
                title={uploading ? "Uploading…" : hasPhoto ? "Change photo" : "Use a photo"}
                loading={uploading}
                onPress={() => void pickPhoto()}
              />
            </View>
            {photoFileId ? (
              <PressableScale onPress={() => setPhotoFileId(null)} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove avatar">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Sym name="xmark.circle.fill" size={14} color={colors.textFaint} />
                  <T kind="detail">Use initials</T>
                </View>
              </PressableScale>
            ) : null}
          </View>
        </Card>
      </Rise>

      <Rise index={4}>
        <Button title={busy ? "Saving…" : "Save"} variant="ember" full loading={busy} onPress={() => void save()} />
      </Rise>
    </HScreen>
  );
}
