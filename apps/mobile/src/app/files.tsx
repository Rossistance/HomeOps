import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { api, type ArtifactRec, type FileRec, type MemoryRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Files & Knowledge — the household's server-owned file library (upload from the
// phone's photo library or files app) plus the read-only knowledge the helpers
// have accumulated (memory entries + run artifacts).
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MAX_BYTES = 5 * 1024 * 1024;

type Tab = "files" | "knowledge";

export default function FilesScreen() {
  const { session } = useSession();
  const canUpload = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(session?.role ?? "");
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<FileRec[]>([]);
  const [memory, setMemory] = useState<MemoryRec[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [preview, setPreview] = useState<{ id: string; mime: string; text?: string; dataUri?: string } | null>(null);

  const load = useCallback(async () => {
    const [f, m, a] = await Promise.all([api.files(), api.memory(), api.artifacts()]);
    setFiles(f); setMemory(m); setArtifacts(a);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const upload = async (name: string, contentBase64: string, mime: string) => {
    const r = await api.uploadFile({ name, contentBase64, mime });
    if (r.file) { setNotice({ text: `${name} uploaded.`, ok: true }); await load(); }
    else setNotice({ text: r.error === "too_large" ? "That file is over the 5 MB cap." : r.error === "insufficient_role" ? "Uploading needs Limited Member or higher." : `Upload failed: ${r.message ?? r.error ?? "unknown error"}`, ok: false });
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
    const isText = f.mime.startsWith("text/") || /json|csv|markdown/.test(f.mime);
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

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <H1>Files &amp; Knowledge</H1>
        <Muted style={{ marginTop: 4 }}>The household's shared documents, and what your helpers know.</Muted>

        <View style={st.tabRow}>
          {(["files", "knowledge"] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[st.tabChip, tab === t && st.tabChipActive]}
              accessibilityRole="tab" accessibilityState={{ selected: tab === t }} accessibilityLabel={t === "files" ? "Files" : "Knowledge"}>
              <Body style={{ fontSize: 13, fontWeight: "600", color: tab === t ? Hearth.white : Hearth.ink600 }}>
                {t === "files" ? `Files (${files.length})` : `Knowledge (${memory.length + artifacts.length})`}
              </Body>
            </Pressable>
          ))}
        </View>

        {notice ? (
          <View style={[st.notice, { backgroundColor: notice.ok ? Hearth.sageBg : Hearth.coralBg, borderColor: notice.ok ? Hearth.sage500 : Hearth.coral500 }]}>
            <Body style={{ color: notice.ok ? Hearth.sage600 : Hearth.coral600, fontSize: 14 }}>{notice.text}</Body>
          </View>
        ) : null}

        {tab === "files" ? (
          <>
            {canUpload ? (
              <View style={st.btnRow}>
                <View style={{ flex: 1 }}>
                  <Button title="Upload document" variant="primary" loading={busy === "doc"} onPress={() => void pickDocument()} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Upload photo" variant="ghost" loading={busy === "photo"} onPress={() => void pickPhoto()} />
                </View>
              </View>
            ) : (
              <Muted style={{ marginTop: 12, fontSize: 12 }}>You can browse the library; uploading needs Limited Member or higher.</Muted>
            )}

            {files.length === 0 ? (
              <Card style={{ marginTop: 12 }}><Muted>No files in the household library yet.{canUpload ? " Upload a school form, permission slip, or photo to get started." : ""}</Muted></Card>
            ) : (
              files.map((f) => (
                <Card key={f.id} style={{ marginTop: 8 }}>
                  <Pressable onPress={() => void openPreview(f)} accessibilityRole="button" accessibilityLabel={`${f.name}, ${fmtSize(f.sizeBytes)}${preview?.id === f.id ? ", close preview" : ", open preview"}`}>
                    <View style={st.between}>
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Ionicons name={f.mime.startsWith("image/") ? "image-outline" : "document-text-outline"} size={20} color={Hearth.ink500} />
                        <View style={{ flex: 1 }}>
                          <Body style={{ fontWeight: "600" }} >{f.name}</Body>
                          <Muted style={{ fontSize: 12 }}>{fmtSize(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}{f.tags.length ? ` · ${f.tags.join(", ")}` : ""}</Muted>
                        </View>
                      </View>
                      {busy === `open:${f.id}` ? <Ionicons name="hourglass-outline" size={16} color={Hearth.ink400} /> : <Ionicons name={preview?.id === f.id ? "chevron-up" : "chevron-down"} size={16} color={Hearth.ink400} />}
                    </View>
                  </Pressable>
                  {preview?.id === f.id && (
                    <View style={{ marginTop: 10, gap: 8 }}>
                      {preview.dataUri ? (
                        <Image source={{ uri: preview.dataUri }} style={st.previewImg} resizeMode="contain" accessibilityLabel={`Preview of ${f.name}`} />
                      ) : preview.text != null ? (
                        <View style={st.previewText}><Muted style={{ fontSize: 12 }}>{preview.text}</Muted></View>
                      ) : (
                        <Muted style={{ fontSize: 12 }}>No inline preview for {f.mime}. Open it on the web app to download.</Muted>
                      )}
                      <Button title="Remove file" variant="danger" loading={busy === `del:${f.id}`} onPress={() => void removeFile(f)} />
                    </View>
                  )}
                </Card>
              ))
            )}
          </>
        ) : (
          <>
            <View style={{ marginTop: 16 }}><Eyebrow>Memory</Eyebrow></View>
            <Muted style={{ marginTop: 4, fontSize: 12 }}>What HomeOps has learned from real runs — read-only here.</Muted>
            {memory.length === 0 ? (
              <Card style={{ marginTop: 8 }}><Muted>No memory entries yet. They appear as your helpers complete runs.</Muted></Card>
            ) : (
              memory.map((m) => (
                <Card key={m.id} style={{ marginTop: 8 }}>
                  <View style={st.row}>
                    <Badge label={m.type || m.scope} color={Hearth.lavender500} bg={Hearth.lavenderBg} />
                    <Muted style={{ fontSize: 11 }}>{new Date(m.createdAt).toLocaleDateString()}</Muted>
                  </View>
                  <Body style={{ fontSize: 14, marginTop: 6 }}>{m.text}</Body>
                </Card>
              ))
            )}

            <View style={{ marginTop: 20 }}><Eyebrow>Artifacts</Eyebrow></View>
            <Muted style={{ marginTop: 4, fontSize: 12 }}>Documents and outputs produced by runs.</Muted>
            {artifacts.length === 0 ? (
              <Card style={{ marginTop: 8 }}><Muted>No artifacts yet.</Muted></Card>
            ) : (
              artifacts.map((a) => (
                <Card key={a.id} style={{ marginTop: 8 }}>
                  <View style={st.row}>
                    <Badge label={a.kind} color={Hearth.sky500} bg={Hearth.skyBg} />
                    <Muted style={{ fontSize: 11 }}>{new Date(a.createdAt).toLocaleDateString()}</Muted>
                  </View>
                  <Body style={{ fontWeight: "600", marginTop: 6 }}>{a.title}</Body>
                  {a.body ? <Muted style={{ fontSize: 12, marginTop: 4 }}>{a.body.slice(0, 400)}</Muted> : null}
                </Card>
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  notice: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  tabRow: { flexDirection: "row", gap: 6, marginTop: 14 },
  tabChip: { borderRadius: 999, borderWidth: 1, borderColor: Hearth.border, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: Hearth.white },
  tabChipActive: { backgroundColor: Hearth.ink800, borderColor: Hearth.ink800 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  previewImg: { width: "100%", height: 220, borderRadius: 12, backgroundColor: Hearth.surfaceSunken },
  previewText: { borderRadius: 12, backgroundColor: Hearth.surfaceSunken, padding: 12, maxHeight: 260, overflow: "hidden" },
});
