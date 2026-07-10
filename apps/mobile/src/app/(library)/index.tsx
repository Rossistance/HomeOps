// Library — the household's document home. Spaces grid (real file groupings),
// recent documents with badges, search, inline preview, plus the read-only
// knowledge the agents have accumulated. Uploads run through the Upload sheet.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { api, type ArtifactRec, type FileRec, type MemoryRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import {
  Badge, Button, Card, EmptyState, HScreen, MarkdownText, Notice, PressableScale, Rise,
  SectionHeader, SkeletonCards, Sym, SymTile, T, Well,
} from "@/components/ui";
import { UploadSheet } from "@/components/sheets/upload-sheet";

const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isTextMime = (mime: string) => mime.startsWith("text/") || /json|csv|markdown/.test(mime);
const fileIcon = (mime: string) => (mime.startsWith("image/") ? "photo" : isTextMime(mime) ? "doc.text" : "doc");

type Tab = "files" | "knowledge";

// The four handoff spaces, matched against real file spaceId/tags/name keywords.
const SPACE_DEFS = [
  { key: "school", label: "School", icon: "graduationcap", tint: "sky", match: /school|class|teacher|homework|permission/i },
  { key: "medical", label: "Medical & IDs", icon: "heart", tint: "lavender", sensitive: true, match: /medic|health|passport|id|insurance-card|sensitive/i },
  { key: "bills", label: "Bills & Receipts", icon: "tag", tint: "amber", match: /bill|receipt|invoice|utility|statement/i },
  { key: "home", label: "Home", icon: "wrench.adjustable", tint: "sage", match: /./ },
] as const;
type SpaceKey = (typeof SPACE_DEFS)[number]["key"];

function spaceOf(f: FileRec): SpaceKey {
  const hay = `${f.spaceId} ${f.tags.join(" ")} ${f.name}`;
  for (const s of SPACE_DEFS) if (s.match.test(hay)) return s.key;
  return "home";
}

export default function LibraryScreen() {
  const { session } = useSession();
  const { colors, spacing, radii } = useTheme();
  const { upload: uploadParam } = useLocalSearchParams<{ upload?: string }>();
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [spaceFilter, setSpaceFilter] = useState<SpaceKey | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [f, m, a] = await Promise.all([api.files(), api.memory(), api.artifacts()]);
    setFiles(f); setMemory(m); setArtifacts(a);
    setLoaded(true);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  useEffect(() => { if (uploadParam === "1" && canUpload) setUploadOpen(true); }, [uploadParam, canUpload]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setFilter(query.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const spaceCounts = useMemo(() => {
    const m = new Map<SpaceKey, number>();
    for (const f of files) m.set(spaceOf(f), (m.get(spaceOf(f)) ?? 0) + 1);
    return m;
  }, [files]);

  const visibleFiles = useMemo(() => {
    let out = [...files].sort((a, b) => b.createdAt.localeCompare?.(a.createdAt) ?? 0);
    if (spaceFilter) out = out.filter((f) => spaceOf(f) === spaceFilter);
    if (filter) {
      out = out.filter((f) =>
        f.name.toLowerCase().includes(filter) ||
        f.mime.toLowerCase().includes(filter) ||
        f.tags.some((t) => t.toLowerCase().includes(filter)));
    }
    return out;
  }, [files, filter, spaceFilter]);

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

  const badgeFor = (f: FileRec) => {
    const sensitive = f.visibility === "private" || f.tags.includes("sensitive");
    if (sensitive) return { label: "Sensitive", fg: colors.lavender, bg: colors.lavenderBg };
    if (Date.now() - Date.parse(f.createdAt) < 5 * 60 * 1000) return { label: "Processing", fg: colors.sky, bg: colors.skyBg };
    return null;
  };

  const spaceLabel = (k: SpaceKey) => SPACE_DEFS.find((s) => s.key === k)?.label ?? "Home";

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <Rise index={0}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {/* Files / Knowledge segmented */}
          <View style={{ flexDirection: "row", backgroundColor: colors.surfaceSunken, borderRadius: 12, borderCurve: "continuous", padding: 3, gap: 2, flex: 1, marginRight: spacing.md }}>
            {(["files", "knowledge"] as const).map((t) => (
              <PressableScale key={t} onPress={() => { tapHaptic("select"); setTab(t); }} haptic={null}
                style={{ flex: 1, paddingVertical: 7, borderRadius: 9, borderCurve: "continuous", alignItems: "center", backgroundColor: tab === t ? colors.surface : "transparent" }}>
                <T kind="caption" color={tab === t ? colors.text : colors.textSecondary} style={{ fontSize: 12.5 }}>
                  {t === "files" ? `Files (${files.length})` : `Knowledge (${memory.length + artifacts.length})`}
                </T>
              </PressableScale>
            ))}
          </View>
          {canUpload && tab === "files" && (
            <PressableScale onPress={() => setUploadOpen(true)} haptic="select" accessibilityRole="button" accessibilityLabel="Upload"
              style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.emberBg, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }}>
              <Sym name="square.and.arrow.up" size={13} color={colors.ember} />
              <T kind="subMedium" color={colors.ember}>Upload</T>
            </PressableScale>
          )}
        </View>
      </Rise>

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {!loaded ? (
        <SkeletonCards count={4} />
      ) : tab === "files" ? (
        <>
          <Rise index={1}>
            <View style={{
              flexDirection: "row", alignItems: "center", gap: spacing.sm,
              backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous",
              paddingHorizontal: spacing.md, minHeight: 44,
            }}>
              <Sym name="magnifyingglass" size={15} color={colors.textFaint} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 }}
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

          {/* Spaces grid */}
          <Rise index={2}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {SPACE_DEFS.map((s) => {
                const count = spaceCounts.get(s.key) ?? 0;
                const active = spaceFilter === s.key;
                const fg = colors[s.tint];
                const bg = colors[`${s.tint}Bg`];
                return (
                  <PressableScale
                    key={s.key}
                    onPress={() => { tapHaptic("select"); setSpaceFilter(active ? null : s.key); }}
                    haptic={null}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.label}, ${count} files${active ? ", filtering" : ""}`}
                    style={{
                      flexBasis: "48%", flexGrow: 1, padding: spacing.lg, gap: 8,
                      borderRadius: 22, borderCurve: "continuous",
                      backgroundColor: colors.surface,
                      borderWidth: active ? 1.5 : 1, borderColor: active ? fg : colors.border,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <SymTile name={s.icon} color={fg} bg={bg} size={38} iconSize={17} />
                      {"sensitive" in s && s.sensitive ? <Sym name="checkmark.shield" size={13} color={colors.lavender} /> : null}
                    </View>
                    <View>
                      <T kind="rowTitle">{s.label}</T>
                      <T kind="detail">{count} file{count === 1 ? "" : "s"}</T>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          </Rise>

          <SectionHeader title={spaceFilter ? spaceLabel(spaceFilter) : "Recent documents"} />
          {visibleFiles.length === 0 ? (
            filter || spaceFilter ? (
              <EmptyState icon="magnifyingglass" title="No matches" hint="Nothing in the library matches that." />
            ) : (
              <EmptyState
                icon="folder"
                title="No files yet"
                hint={canUpload ? "Upload a school form, permission slip, or photo to get started." : "The household library is empty."}
              />
            )
          ) : (
            visibleFiles.map((f, i) => {
              const open = preview?.id === f.id;
              const b = badgeFor(f);
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
                        <SymTile name={fileIcon(f.mime)} color={colors.textSecondary} bg={colors.surfaceSunken} size={36} iconSize={16} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <T kind="rowTitle" numberOfLines={1}>{f.name}</T>
                          <T kind="detail" numberOfLines={1}>
                            {spaceLabel(spaceOf(f))} · {fmtSize(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}{f.uploadedBy ? ` · ${f.uploadedBy}` : ""}
                          </T>
                        </View>
                        {b && <Badge label={b.label} fg={b.fg} bg={b.bg} />}
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
            <T kind="sub">What Famili has learned from real runs — read-only here.</T>
          </Rise>
          {memory.length === 0 ? (
            <EmptyState icon="brain" title="No memory yet" hint="Entries appear as your agents complete runs." />
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
          {artifacts.length === 0 ? (
            <EmptyState icon="doc.text" title="No artifacts yet" hint="Run outputs will collect here." />
          ) : (
            artifacts.map((a, i) => {
              const open = expandedArtifact === a.id;
              // Bare URLs in artifact bodies become tappable markdown links.
              const linked = (a.body ?? "").replace(/(?<![([])(https?:\/\/[^\s)\]]+)/g, "[$1]($1)");
              return (
                <Rise key={a.id} index={Math.min(i + 3, 8)}>
                  <Card style={{ gap: spacing.sm }}>
                    <PressableScale onPress={() => { tapHaptic("select"); setExpandedArtifact(open ? null : a.id); }} haptic={null} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ gap: spacing.sm }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                        <Badge label={a.kind.replace(/_/g, " ")} fg={colors.sky} bg={colors.skyBg} />
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <T kind="caption" color={colors.textFaint}>{new Date(a.createdAt).toLocaleDateString()}</T>
                          <Sym name={open ? "chevron.up" : "chevron.down"} size={12} color={colors.textFaint} />
                        </View>
                      </View>
                      <T kind="rowTitle">{a.title}</T>
                    </PressableScale>
                    {a.body ? (
                      open
                        ? <MarkdownText text={linked} />
                        : <T kind="sub" numberOfLines={3}>{a.body.slice(0, 240)}</T>
                    ) : null}
                  </Card>
                </Rise>
              );
            })
          )}
        </>
      )}

      <UploadSheet visible={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => void load()} />
    </HScreen>
  );
}
