// Upload-a-document sheet (84%). Step 1: pick a source (camera scan, Photos,
// Files). Step 2: file it under a space, optionally mark sensitive, upload for
// real (base64, 5 MB cap — same pipeline as the web app).
import { useState } from "react";
import { ScrollView, Switch, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import { api, type FileRec } from "@/lib/api";
import { decideSpace, explicitTagOf, spaceLabelOf } from "@/lib/spaces";
import { useTheme } from "@/theme";
import {
  T, Button, Chip, ChipRow, Well, Row, SymTile, PressableScale, Sym, HSheet, SheetCTA, Notice,
} from "@/components/ui";

const MAX_BYTES = 5 * 1024 * 1024;
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const SPACES = ["Let Famili decide", "School", "Medical & IDs", "Bills & Receipts", "Home"] as const;
const spaceTag = (s: string) => s.toLowerCase().replace(/\s*&\s*/g, "-").replace(/\s+/g, "-");

interface Picked { name: string; base64: string; mime: string; size: number }

export function UploadSheet({ visible, onClose, onUploaded }: {
  visible: boolean;
  onClose: () => void;
  /** Called with the uploaded record — the library shows the persistent "Saved to <category>" confirmation (WP-002). */
  onUploaded: (file: FileRec) => void;
}) {
  const { colors, spacing } = useTheme();
  const [file, setFile] = useState<Picked | null>(null);
  // Optional 2nd page (e.g. the back of an ID) — uploaded as ONE logical file.
  const [backPage, setBackPage] = useState<Picked | null>(null);
  // Editable display name, prefilled from the picked file (extension kept).
  const [customName, setCustomName] = useState("");
  const [space, setSpace] = useState<string>(SPACES[0]);
  const [sensitive, setSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function reset() { setFile(null); setBackPage(null); setCustomName(""); setSpace(SPACES[0]); setSensitive(false); setBusy(false); setNote(null); }
  function close() { reset(); onClose(); }

  async function fromDocument() {
    setNote(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if ((a.size ?? 0) > MAX_BYTES) { setNote("That file is over the 5 MB cap."); return; }
      const b64 = await readAsStringAsync(a.uri, { encoding: "base64" });
      setBackPage(null); // documents are single-page
      const picked = { name: a.name ?? "document", base64: b64, mime: a.mimeType ?? "application/octet-stream", size: a.size ?? Math.round(b64.length * 0.75) };
      setFile(picked);
      setCustomName(picked.name);
    } catch (e) {
      setNote(`Couldn't read that file: ${String((e as Error)?.message ?? e)}`);
    }
  }

  // Convert a picked image asset into a Picked (or set a note + return null on failure).
  function toPicked(a: ImagePicker.ImagePickerAsset, label: string): Picked | null {
    if (!a.base64) { setNote("Couldn't read that photo."); return null; }
    if (a.base64.length * 0.75 > MAX_BYTES) { setNote("That photo is over the 5 MB cap."); return null; }
    return {
      name: a.fileName ?? `${label}-${Date.now()}.jpg`,
      base64: a.base64, mime: a.mimeType ?? "image/jpeg",
      size: Math.round(a.base64.length * 0.75),
    };
  }

  // Camera captures one page; the library allows selecting up to two at once (multi).
  async function pickImages(camera: boolean, multi: boolean): Promise<ImagePicker.ImagePickerAsset[] | null> {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setNote("Camera access was denied."); return null; }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setNote("Photo library access was denied."); return null; }
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"], base64: true, quality: 0.8,
      allowsMultipleSelection: !camera && multi, selectionLimit: 2,
    };
    const res = camera
      ? await ImagePicker.launchCameraAsync(opts).catch(() => ImagePicker.launchImageLibraryAsync(opts))
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return null;
    return res.assets;
  }

  // First page. Library multi-select can fill front + back in one pass.
  async function fromImages(camera: boolean) {
    setNote(null);
    try {
      const assets = await pickImages(camera, true);
      if (!assets) return;
      const first = toPicked(assets[0], camera ? "scan" : "photo");
      if (!first) return;
      setFile(first);
      setCustomName(first.name);
      const second = assets[1] ? toPicked(assets[1], "back") : null;
      setBackPage(second);
    } catch (e) {
      setNote(`Couldn't read that photo: ${String((e as Error)?.message ?? e)}`);
    }
  }

  // Add the second page (e.g. the back of an ID) after the front is set.
  async function addBackPage(camera: boolean) {
    setNote(null);
    try {
      const assets = await pickImages(camera, false);
      if (!assets) return;
      const back = toPicked(assets[0], "back");
      if (back) setBackPage(back);
    } catch (e) {
      setNote(`Couldn't read that photo: ${String((e as Error)?.message ?? e)}`);
    }
  }

  // Removing the front promotes the back to front (so there's never a back with no front).
  function removeFront() {
    if (backPage) { setFile(backPage); setBackPage(null); setCustomName(backPage.name); }
    else { setFile(null); setCustomName(""); }
  }

  async function submit() {
    if (!file || busy) return;
    setBusy(true); setNote(null);
    const tags: string[] = [];
    // Explicit filing, always (WP-002/ISS-002): "Let Famili decide" runs the
    // unit-tested name heuristic and files the result EXPLICITLY — never a
    // silent untagged fallback. The library banner then names the real category.
    tags.push(space === SPACES[0] ? explicitTagOf(decideSpace(customName.trim() || file.name)) : spaceTag(space));
    if (sensitive) tags.push("sensitive");
    // The typed name wins, exactly as typed — except a lost dot-extension is
    // restored from the original so the file stays openable.
    let name = customName.trim() || file.name;
    const origExt = /\.[A-Za-z0-9]+$/.exec(file.name)?.[0];
    if (origExt && !/\.[A-Za-z0-9]+$/.test(name)) name += origExt;
    // Two pages → one logical multi-page file (contentBase64 stays the first-page blob).
    const pages = backPage ? [{ base64: file.base64 }, { base64: backPage.base64 }] : undefined;
    const r = await api.uploadFile({
      name, contentBase64: file.base64, mime: file.mime,
      tags: tags.length ? tags : undefined,
      visibility: sensitive ? "private" : undefined,
      pages,
    });
    setBusy(false);
    if (!r.file) {
      setNote(r.error === "too_large" ? "That file is over the 5 MB cap."
        : r.error === "insufficient_role" ? "Uploading needs Limited Member or higher."
        : `Upload failed: ${r.message ?? r.error ?? "unknown error"}`);
      return;
    }
    // WP-002: no more 800 ms flash — hand the record to the library, which shows
    // the persistent "Saved to <category> · View" confirmation until dismissed.
    onUploaded(r.file);
    close();
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
                <Row icon="camera" iconColor={colors.ember} iconBg={colors.emberBg} title="Scan a paper form" subtitle="Use the camera · add a back page after" chevron onPress={() => void fromImages(true)} />
                <Row icon="photo" iconColor={colors.sky} iconBg={colors.skyBg} title="Choose from Photos" subtitle="Pick up to 2 (front & back)" chevron onPress={() => void fromImages(false)} />
                <Row icon="folder" iconColor={colors.amber} iconBg={colors.amberBg} title="Browse Files" subtitle="PDFs and documents" chevron onPress={() => void fromDocument()} last />
              </View>
              <T kind="detail" center>
                Files stay in your household library —{"\n"}nothing is shared outside without approval.
              </T>
            </>
          ) : (
            <>
              <View style={{ gap: spacing.sm }}>
                <FileTile picked={file} label={backPage ? "Front" : undefined} onRemove={removeFront} />
                {backPage ? <FileTile picked={backPage} label="Back" onRemove={() => setBackPage(null)} /> : null}
                {file.mime.startsWith("image/") && !backPage ? (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Button small variant="neutral" icon="camera" title="Scan back" onPress={() => void addBackPage(true)} /></View>
                    <View style={{ flex: 1 }}><Button small variant="neutral" icon="photo" title="Add back" onPress={() => void addBackPage(false)} /></View>
                  </View>
                ) : null}
                {backPage ? <T kind="detail" center>Front &amp; back upload together as one document.</T> : null}
              </View>

              <View style={{ gap: 8 }}>
                <T kind="eyebrow">Name</T>
                <Well style={{ padding: 0 }}>
                  <TextInput
                    value={customName}
                    onChangeText={setCustomName}
                    placeholder={file.name}
                    placeholderTextColor={colors.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="File name"
                    style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
                  />
                </Well>
                <T kind="detail">Give it a name you'll search for — e.g. 'Insurance card front'</T>
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
                <T kind="detail">
                  {space === SPACES[0]
                    ? `Famili will file this under ${spaceLabelOf(decideSpace(customName.trim() || file.name))} — pick a space above to change that.`
                    : `Filed under ${space} in your household library.`}
                </T>
              </Well>
            </>
          )}
        </ScrollView>
      </HSheet>
    </>
  );
}

/** One picked page (front or back). Image pages show a photo glyph. */
function FileTile({ picked, label, onRemove }: { picked: Picked; label?: string; onRemove: () => void }) {
  const { colors, spacing } = useTheme();
  const isImg = picked.mime.startsWith("image/");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: 13, borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <SymTile name={isImg ? "photo" : "doc.text"} color={colors.ember} bg={colors.emberBg} size={40} iconSize={18} />
      <View style={{ flex: 1, gap: 2 }}>
        {label ? <T kind="caption" color={colors.textFaint}>{label.toUpperCase()}</T> : null}
        <T kind="rowTitle" numberOfLines={1}>{picked.name}</T>
        <T kind="detail">{fmtSize(picked.size)}</T>
      </View>
      <PressableScale onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${label ?? "file"}`}>
        <Sym name="xmark" size={15} color={colors.textFaint} />
      </PressableScale>
    </View>
  );
}
