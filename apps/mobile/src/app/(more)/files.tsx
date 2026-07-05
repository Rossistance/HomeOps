// Files & Knowledge — the household's server-owned file library (upload from the
// phone's photo library or files app) plus the read-only knowledge the helpers
// have accumulated (memory entries + run artifacts). Search filters client-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import { api, type ArtifactRec, type FileRec, type MemoryRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";
import {
  Badge, Button, Card, Chip, ChipRow, EmptyState, HScreen, Notice,
  PressableScale, Rise, SectionHeader, SkeletonCards, Sym, SymTile, T, Well,
} from "@/components/ui";

const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MAX_BYTES = 5 * 1024 * 1024;

type Tab = "files" | "knowledge";

const isTextMime = (mime: string) => mime.startsWith("text/") || /json|csv|markdown/.test(mime);

function fileIcon(mime: string): string {
  if (mime.startsWith("image/")) return "photo";
  if (isTextMime(mime)) return "doc.text";
  return "doc";
}

export default function FilesScreen() {
  const { session } = useSession();
  const { colors, spacing, radii, fonts } = useTheme();
  const canUpload = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(session?.role ?? "");
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<FileRec[]>([]);
  const [memory, setMemory] = useState<MemoryRec[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRec[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [preview, setPreview] = useState<{ id: string; mime: string; text?: string; dataUri?: string } | null>(null);
  // Client-side search — `query` is the raw keystroke state, `filter` the debounced value.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const [f, m, a] = await Promise.all([api.files(), api.memory(), api.artifacts()]);
    setFiles(f); setMemory(m); setArtifacts(a);
    setLoaded(true);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setFilter(query.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const visibleFiles = useMemo(() => {
    if (!filter) return files;
    return files.filter((f) =>
      f.name.toLowerCase().includes(filter) ||
      f.mime.toLowerCase().includes(filter) ||
      f.tags.some((t) => t.toLowerCase().includes(filter)),
    );
  }, [files, filter]);

  const upload = async (name: string, contentBase64: string, mime: string) => {
    const r = await api.uploadFile({ name, contentBase64, mime });
    if (r.file) { setNotice({ text: `${name} uploaded.`, ok: true }); await load(); }
    else setNotice({
      text: r.error === "too_large" ? "That file is over the 5 MB cap."
        : r.error === "insufficient_role" ? "Uploading needs Limited Member or higher."
        : `Upload failed: ${r.message ?? r.error ?? "unknown error"}`,
      ok: false,
    });
  };

  const pickDocument = async () => {
    setBusy("doc"); setNotice(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if ((a.size ?? 0) > MAX_BYTES) { setNotice({ text: "That file is over the 5 MB cap.", ok: false }); return; }
      const b64 = await readAsStringAsync(a.uri, { encoding: "base64" });
      await upload(a.name ?? "document", b64, a.mimeType ?? "application/octet-stream");
    } catch (e) {
      setNotice({ text: `Couldn't read that file: ${String((e as Error)?.message ?? e)}`, ok: false });
    } finally { setBusy(null); }
  };

  const pickPhoto = async () => {
    setBusy("photo"); setNotice(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setNotice({ text: "Photo library access was denied.", ok: false }); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.8 });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const a = res.assets[0];
      if (a.base64!.length * 0.75 > MAX_BYTES) { setNotice({ text: "That photo is over the 5 MB cap.", ok: false }); return; }
      const name = a.fileName ?? `photo-${Date.now()}.jpg`;
      await upload(name, a.base64!, a.mimeType ?? "image/jpeg");
    } catch (e) {
      setNotice({ text: `Couldn't read that photo: ${String((e as Error)?.message ?? e)}`, ok: false });
    } finally { setBusy(null); }
  };

  const openPreview = async (f: FileRec) => {
    if (preview?.id === f.id) { setPreview(null); return; }
    const isText = isTextMime(f.mime);
    const isImage = f.mime.startsWith("image/");
    if (!isText && !isImage) { setPreview({ id: f.id, mime: f.mime }); return; }
    setBusy(`open:${f.id}`);
    const c = await api.fileContent(f.id);
    setBusy(null);
    if (!c.contentBase64) { setNotice({ text: `Couldn't load content: ${c.error ?? "unknown"}`, ok: false }); return; }
    if (isText) {
      let text = "";
      try { text = decodeURIComponent(escape(atob(c.contentBase64))); } catch { text = "(couldn't decode text)"; }
      setPreview({ id: f.id, mime: f.mime, text: text.slice(0, 2000) });
    } else {
      setPreview({ id: f.id, mime: f.mime, dataUri: `data:${f.mime};base64,${c.contentBase64}` });
    }
  };

  const removeFile = async (f: FileRec) => {
    setBusy(`del:${f.id}`);
    const r = await api.deleteFile(f.id);
    setBusy(null);
    if (r.ok) { setPreview((p) => (p?.id === f.id ? null : p)); setNotice({ text: `${f.name} removed.`, ok: true }); }
    else setNotice({ text: r.error === "forbidden" ? "You can only remove files you uploaded." : `Couldn't remove: ${r.error}`, ok: false });
    await load();
  };

  const confirmRemove = (f: FileRec) => {
    Alert.alert(`Remove “${f.name}”?`, "This deletes it from the household library for everyone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void removeFile(f) },
    ]);
  };

  const fileTone = (mime: string) =>
    mime.startsWith("image/") ? { fg: colors.sky, bg: colors.skyBg }
      : isTextMime(mime) ? { fg: colors.amber, bg: colors.amberBg }
      : { fg: colors.textMuted, bg: colors.surfaceSunken };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <Rise index={0}>
        <ChipRow>
          <Chip label={`Files (${files.length})`} selected={tab === "files"} icon="folder" onPress={() => setTab("files")} />
          <Chip label={`Knowledge (${memory.length + artifacts.length})`} selected={tab === "knowledge"} icon="brain" onPress={() => setTab("knowledge")} />
        </ChipRow>
      </Rise>

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {!loaded ? (
        <SkeletonCards count={4} />
      ) : tab === "files" ? (
        <>
          {canUpload ? (
            <Rise index={1} style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Upload document" variant="ember" icon="doc.badge.plus" full loading={busy === "doc"} onPress={() => void pickDocument()} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Upload photo" variant="neutral" icon="photo" full loading={busy === "photo"} onPress={() => void pickPhoto()} />
              </View>
            </Rise>
          ) : (
            <Rise index={1}>
              <T kind="sub">You can browse the library; uploading needs Limited Member or higher.</T>
            </Rise>
          )}

          <Rise index={2}>
            <View style={{
              flexDirection: "row", alignItems: "center", gap: spacing.sm,
              backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous",
              paddingHorizontal: spacing.md, minHeight: 44,
            }}>
              <Sym name="magnifyingglass" size={15} color={colors.textFaint} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 10 }}
                placeholder="Search by name or type"
                placeholderTextColor={colors.textFaint}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                accessibilityLabel="Search files by name or type"
              />
            </View>
          </Rise>

          {visibleFiles.length === 0 ? (
            filter ? (
              <EmptyState icon="magnifyingglass" title="No matches" hint={`Nothing in the library matches “${query.trim()}”.`} />
            ) : (
              <EmptyState
                icon="folder"
                title="No files yet"
                hint={canUpload ? "Upload a school form, permission slip, or photo to get started." : "The household library is empty."}
              />
            )
          ) : (
            visibleFiles.map((f, i) => {
              const tn = fileTone(f.mime);
              const open = preview?.id === f.id;
              return (
                <Rise key={f.id} index={Math.min(i + 3, 8)}>
                  <Card padded={false}>
                    <PressableScale
                      scaleTo={0.99}
                      haptic="select"
                      onPress={() => void openPreview(f)}
                      accessibilityRole="button"
                      accessibilityLabel={`${f.name}, ${fmtSize(f.sizeBytes)}${open ? ", close preview" : ", open preview"}`}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg }}>
                        <SymTile name={fileIcon(f.mime)} color={tn.fg} bg={tn.bg} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <T kind="bodyMedium" color={colors.text} numberOfLines={1}>{f.name}</T>
                          <T kind="sub" numberOfLines={1}>
                            {fmtSize(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}{f.tags.length ? ` · ${f.tags.join(", ")}` : ""}
                          </T>
                        </View>
                        {busy === `open:${f.id}`
                          ? <ActivityIndicator size="small" color={colors.textFaint} />
                          : <Sym name={open ? "chevron.up" : "chevron.down"} size={13} color={colors.textFaint} />}
                      </View>
                    </PressableScale>
                    {open && (
                      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm }}>
                        <Well>
                          {preview.dataUri ? (
                            <Image
                              source={{ uri: preview.dataUri }}
                              style={{ width: "100%", height: 220, borderRadius: radii.sm }}
                              contentFit="contain"
                              accessibilityLabel={`Preview of ${f.name}`}
                            />
                          ) : preview.text != null ? (
                            <T kind="sub" selectable>{preview.text}</T>
                          ) : (
                            <T kind="sub">No inline preview for {f.mime}. Open it on the web app to download.</T>
                          )}
                        </Well>
                        <Button title="Remove file" variant="danger" small loading={busy === `del:${f.id}`} onPress={() => confirmRemove(f)} />
                      </View>
                    )}
                  </Card>
                </Rise>
              );
            })
          )}
        </>
      ) : (
        <>
          <SectionHeader title="Memory" />
          <Rise index={1}>
            <T kind="sub">What HomeOps has learned from real runs — read-only here.</T>
          </Rise>
          {memory.length === 0 ? (
            <EmptyState icon="brain" title="No memory yet" hint="Entries appear as your helpers complete runs." />
          ) : (
            memory.map((m, i) => (
              <Rise key={m.id} index={Math.min(i + 2, 8)}>
                <Card style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                    <Badge label={m.type || m.scope} fg={colors.lavender} bg={colors.lavenderBg} />
                    <T kind="caption" color={colors.textFaint}>{new Date(m.createdAt).toLocaleDateString()}</T>
                  </View>
                  <T kind="body" selectable>{m.text}</T>
                </Card>
              </Rise>
            ))
          )}

          <SectionHeader title="Artifacts" />
          <Rise index={2}>
            <T kind="sub">Documents and outputs produced by runs.</T>
          </Rise>
          {artifacts.length === 0 ? (
            <EmptyState icon="doc.text" title="No artifacts yet" hint="Run outputs will collect here." />
          ) : (
            artifacts.map((a, i) => (
              <Rise key={a.id} index={Math.min(i + 3, 8)}>
                <Card style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                    <Badge label={a.kind} fg={colors.sky} bg={colors.skyBg} />
                    <T kind="caption" color={colors.textFaint}>{new Date(a.createdAt).toLocaleDateString()}</T>
                  </View>
                  <T kind="bodyMedium" color={colors.text}>{a.title}</T>
                  {a.body ? <T kind="sub" numberOfLines={6}>{a.body.slice(0, 400)}</T> : null}
                </Card>
              </Rise>
            ))
          )}
        </>
      )}
    </HScreen>
  );
}
