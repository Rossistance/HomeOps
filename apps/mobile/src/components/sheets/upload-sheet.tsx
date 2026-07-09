// Upload-a-document sheet (84%). Step 1: pick a source (camera scan, Photos,
// Files). Step 2: file it under a space, optionally mark sensitive, upload for
// real (base64, 5 MB cap — same pipeline as the web app).
import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import { api } from "@/lib/api";
import { useTheme } from "@/theme";
import {
  T, Chip, ChipRow, Well, Row, SymTile, PressableScale, Sym, HSheet, SheetCTA, Notice, useConfirmFlash,
} from "@/components/ui";

const MAX_BYTES = 5 * 1024 * 1024;
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const SPACES = ["Let Famili decide", "School", "Medical & IDs", "Bills & Receipts", "Home"] as const;
const spaceTag = (s: string) => s.toLowerCase().replace(/\s*&\s*/g, "-").replace(/\s+/g, "-");

interface Picked { name: string; base64: string; mime: string; size: number }

export function UploadSheet({ visible, onClose, onUploaded }: {
  visible: boolean;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { colors, spacing } = useTheme();
  const { flash, show } = useConfirmFlash();
  const [file, setFile] = useState<Picked | null>(null);
  const [space, setSpace] = useState<string>(SPACES[0]);
  const [sensitive, setSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function reset() { setFile(null); setSpace(SPACES[0]); setSensitive(false); setBusy(false); setNote(null); }
  function close() { reset(); onClose(); }

  async function fromDocument() {
    setNote(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if ((a.size ?? 0) > MAX_BYTES) { setNote("That file is over the 5 MB cap."); return; }
      const b64 = await readAsStringAsync(a.uri, { encoding: "base64" });
      setFile({ name: a.name ?? "document", base64: b64, mime: a.mimeType ?? "application/octet-stream", size: a.size ?? Math.round(b64.length * 0.75) });
    } catch (e) {
      setNote(`Couldn't read that file: ${String((e as Error)?.message ?? e)}`);
    }
  }

  async function fromImages(camera: boolean) {
    setNote(null);
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setNote("Camera access was denied."); return; }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { setNote("Photo library access was denied."); return; }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true, quality: 0.8 };
      const res = camera
        ? await ImagePicker.launchCameraAsync(opts).catch(() => ImagePicker.launchImageLibraryAsync(opts))
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const a = res.assets[0];
      if (a.base64!.length * 0.75 > MAX_BYTES) { setNote("That photo is over the 5 MB cap."); return; }
      setFile({
        name: a.fileName ?? `${camera ? "scan" : "photo"}-${Date.now()}.jpg`,
        base64: a.base64!, mime: a.mimeType ?? "image/jpeg",
        size: Math.round(a.base64!.length * 0.75),
      });
    } catch (e) {
      setNote(`Couldn't read that photo: ${String((e as Error)?.message ?? e)}`);
    }
  }

  async function submit() {
    if (!file || busy) return;
    setBusy(true); setNote(null);
    const tags: string[] = [];
    if (space !== SPACES[0]) tags.push(spaceTag(space));
    if (sensitive) tags.push("sensitive");
    const r = await api.uploadFile({
      name: file.name, contentBase64: file.base64, mime: file.mime,
      tags: tags.length ? tags : undefined,
      visibility: sensitive ? "private" : undefined,
    });
    setBusy(false);
    if (!r.file) {
      setNote(r.error === "too_large" ? "That file is over the 5 MB cap."
        : r.error === "insufficient_role" ? "Uploading needs Limited Member or higher."
        : `Upload failed: ${r.message ?? r.error ?? "unknown error"}`);
      return;
    }
    show("upload", () => { onUploaded(); close(); });
  }

  return (
    <>
      <HSheet
        visible={visible} onClose={close} title="Upload a document" leftLabel="Cancel" heightPct={0.84}
        footer={file ? <SheetCTA title={busy ? "Uploading…" : "Upload & file"} onPress={() => void submit()} disabled={busy} /> : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg }}>
          {note && <Notice text={note} ok={false} />}
          {!file ? (
            <>
              <View style={{ gap: 2 }}>
                <Row icon="camera" iconColor={colors.ember} iconBg={colors.emberBg} title="Scan a paper form" subtitle="Use the camera" chevron onPress={() => void fromImages(true)} />
                <Row icon="photo" iconColor={colors.sky} iconBg={colors.skyBg} title="Choose from Photos" subtitle="Receipts, forms, snapshots" chevron onPress={() => void fromImages(false)} />
                <Row icon="folder" iconColor={colors.amber} iconBg={colors.amberBg} title="Browse Files" subtitle="PDFs and documents" chevron onPress={() => void fromDocument()} last />
              </View>
              <T kind="detail" center>
                Files stay in your household library —{"\n"}nothing is shared outside without approval.
              </T>
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: 13, borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <SymTile name="doc.text" color={colors.ember} bg={colors.emberBg} size={40} iconSize={18} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T kind="rowTitle" numberOfLines={1}>{file.name}</T>
                  <T kind="detail">{fmtSize(file.size)}</T>
                </View>
                <PressableScale onPress={() => setFile(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove file">
                  <Sym name="xmark" size={15} color={colors.textFaint} />
                </PressableScale>
              </View>

              <View style={{ gap: 8 }}>
                <T kind="eyebrow">File it under</T>
                <ChipRow>
                  {SPACES.map((s) => <Chip key={s} label={s} selected={space === s} onPress={() => setSpace(s)} />)}
                </ChipRow>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile name="checkmark.shield" color={colors.lavender} bg={colors.lavenderBg} size={36} iconSize={16} />
                <View style={{ flex: 1 }}>
                  <T kind="rowTitle">Mark as sensitive</T>
                  <T kind="detail">Only household admins can open it</T>
                </View>
                <Switch value={sensitive} onValueChange={setSensitive} trackColor={{ true: colors.ember }} />
              </View>

              <Well>
                <T kind="detail">Famili will file it and keep it in your household library.</T>
              </Well>
            </>
          )}
        </ScrollView>
      </HSheet>
      {flash}
    </>
  );
}
