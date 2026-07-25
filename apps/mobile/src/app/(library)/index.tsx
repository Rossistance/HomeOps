// Library — the household's document home. Spaces grid (real file groupings),
// recent documents with badges, search, inline preview, plus the read-only
// knowledge the agents have accumulated. Uploads run through the Upload sheet.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Switch, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { api, type RunRec, type ArtifactRec, type FileRec, type KnowledgeRec, type MemoryRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import {
  Badge, Button, Card, Chip, ChipRow, CollapsibleSection, EmptyState, HScreen, HSheet, MarkdownText, Notice, PressableScale, Rise,
  SectionHeader, SheetCTA, SkeletonCards, Sym, SymTile, T, Well,
} from "@/components/ui";
import { UploadSheet } from "@/components/sheets/upload-sheet";
// Categorization is pure + unit-tested (WP-002/ISS-002): explicit space tags win,
// heuristics use word boundaries — see lib/spaces.test.mjs.
import { SPACE_DEFS, spaceOf, type SpaceKey } from "@/lib/spaces";

const KTYPES = ["note", "reference", "contact", "medical", "instructions"] as const;

const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isTextMime = (mime: string) => mime.startsWith("text/") || /json|csv|markdown/.test(mime);
const fileIcon = (mime: string) => (mime.startsWith("image/") ? "photo" : isTextMime(mime) ? "doc.text" : "doc");

type Tab = "files" | "knowledge";

export default function LibraryScreen() {
  const { session } = useSession();
  const { colors, spacing, radii } = useTheme();
  const { upload: uploadParam } = useLocalSearchParams<{ upload?: string }>();
  const canUpload = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(session?.role ?? "");

  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<FileRec[]>([]);
  const [memory, setMemory] = useState<MemoryRec[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRec[]>([]);
  /* A10 [20:06] — "the run summary card needs to show what was INVOLVED — the connectors —
   * and what went wrong and why." The card had a title, a date and a body: nothing about
   * which accounts it touched, and nothing about the steps that didn't happen. Those facts
   * live on the RUN the artifact came from, so the runs are loaded alongside and joined by
   * runId. */
  const [runs, setRuns] = useState<RunRec[]>([]);
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeRec[]>([]);
  // J1 — the tags this household already uses, most-used first. Offering them beats asking
  // everyone to independently remember whether it's "medical" or "health".
  const knownTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const k of knowledge) for (const t of k.tags ?? []) {
      const key = t.trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
  }, [knowledge]);
  const [kOpen, setKOpen] = useState(false);
  const [editingK, setEditingK] = useState<KnowledgeRec | null>(null);
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
  // WP-002: persistent save confirmation — stays until dismissed, names the REAL
  // rendered category (computed by the same spaceOf the list uses).
  const [justUploaded, setJustUploaded] = useState<FileRec | null>(null);

  const load = useCallback(async () => {
    const [f, m, a, k, r] = await Promise.all([api.files(), api.memory(), api.artifacts(), api.knowledge(), api.runs().catch(() => [])]);
    setFiles(f); setMemory(m); setArtifacts(a); setKnowledge(k); setRuns(r);
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

  const removeKnowledge = async (k: KnowledgeRec) => {
    setKnowledge((list) => list.filter((x) => x.id !== k.id)); // optimistic
    const r = await api.deleteKnowledge(k.id);
    if (r.error) {
      await load();
      setNotice({ text: r.error === "insufficient_role" ? "You can't delete this knowledge item." : `Couldn't delete: ${r.error}`, ok: false });
    } else {
      setNotice({ text: `“${k.title}” removed.`, ok: true });
    }
  };
  const confirmRemoveK = (k: KnowledgeRec) => {
    Alert.alert(`Remove “${k.title}”?`, "This deletes it from the household knowledge.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void removeKnowledge(k) },
    ]);
  };

  const removeMemory = async (m: MemoryRec) => {
    setMemory((list) => list.filter((x) => x.id !== m.id)); // optimistic
    const r = await api.deleteMemory(m.id);
    if (r.error) {
      await load();
      setNotice({ text: r.error === "insufficient_role" ? "You can't delete this memory." : `Couldn't delete: ${r.error}`, ok: false });
    } else {
      setNotice({ text: "Memory removed.", ok: true });
    }
  };
  const confirmRemoveMemory = (m: MemoryRec) => {
    Alert.alert("Forget this memory?", "Famili will no longer use it when planning.", [
      { text: "Cancel", style: "cancel" },
      { text: "Forget", style: "destructive", onPress: () => void removeMemory(m) },
    ]);
  };

  const badgeFor = (f: FileRec) => {
    const sensitive = f.visibility === "private" || f.tags.includes("sensitive");
    if (sensitive) return { label: "Sensitive", fg: colors.lavender, bg: colors.lavenderBg };
    // "New" is an honest time-based claim; the old "Processing" implied pending
    // work that didn't exist (ISS-002 — uploads are complete the moment they land).
    if (Date.now() - Date.parse(f.createdAt) < 5 * 60 * 1000) return { label: "New", fg: colors.sky, bg: colors.skyBg };
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
                  {t === "files" ? `Files (${files.length})` : `Knowledge (${knowledge.length + memory.length + artifacts.length})`}
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
          {canUpload && tab === "knowledge" && (
            <PressableScale onPress={() => { setEditingK(null); setKOpen(true); }} haptic="select" accessibilityRole="button" accessibilityLabel="New knowledge"
              style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.emberBg, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }}>
              <Sym name="plus" size={13} color={colors.ember} />
              <T kind="subMedium" color={colors.ember}>New</T>
            </PressableScale>
          )}
        </View>
      </Rise>

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {/* WP-002: persistent, dismissable save confirmation with tap-through */}
      {justUploaded ? (
        <Card style={{ backgroundColor: colors.sageBg, borderColor: "transparent", flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Sym name="checkmark.circle.fill" size={16} color={colors.sage} />
          <T kind="subMedium" style={{ flex: 1 }} numberOfLines={2}>
            Saved to {spaceLabel(spaceOf(justUploaded))} — {justUploaded.name}
          </T>
          <PressableScale
            onPress={() => { tapHaptic("select"); setTab("files"); setSpaceFilter(spaceOf(justUploaded)); setQuery(""); }}
            haptic={null} hitSlop={12} accessibilityRole="button" accessibilityLabel={`View ${justUploaded.name} in ${spaceLabel(spaceOf(justUploaded))}`}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface }}
          >
            <T kind="subMedium" color={colors.sage}>View</T>
          </PressableScale>
          <PressableScale onPress={() => setJustUploaded(null)} haptic={null} hitSlop={14} accessibilityRole="button" accessibilityLabel="Dismiss upload confirmation">
            <Sym name="xmark" size={13} color={colors.textMuted} />
          </PressableScale>
        </Card>
      ) : null}

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
                          <T kind="rowTitle">{f.name}</T>
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
                        {/* TODO(rename): add an inline "Rename" action here once lib/api.ts
                            gains a file PATCH wrapper (e.g. api.patchFile(id, { name })) —
                            no such wrapper exists yet and api.ts is owned by another task. */}
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
          <SectionHeader title="Knowledge" />
          <Rise index={0}>
            <T kind="sub">Facts, preferences, and instructions you want Famili to remember.</T>
          </Rise>
          {knowledge.length === 0 ? (
            <EmptyState
              icon="book"
              title="No knowledge yet"
              hint={canUpload ? "Save allergies, sizes, account notes, house rules — anything Famili should know." : "Adults can add household knowledge here."}
              action={canUpload ? { title: "Add knowledge", onPress: () => { setEditingK(null); setKOpen(true); } } : undefined}
            />
          ) : (
            knowledge.map((k, i) => (
              <Rise key={k.id} index={Math.min(i + 1, 8)}>
                <Card style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Badge label={k.type || "note"} fg={colors.sky} bg={colors.skyBg} />
                    {k.visibility === "personal" ? <Badge label="Personal" fg={colors.textMuted} bg={colors.surfaceSunken} icon="lock" /> : null}
                    {k.sensitive ? <Badge label="Sensitive" fg={colors.lavender} bg={colors.lavenderBg} icon="checkmark.shield" /> : null}
                    <View style={{ flex: 1 }} />
                    <PressableScale onPress={() => { setEditingK(k); setKOpen(true); }} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${k.title}`} style={{ padding: 4 }}>
                      <Sym name="pencil" size={15} color={colors.textMuted} />
                    </PressableScale>
                    <PressableScale onPress={() => confirmRemoveK(k)} haptic="warning" hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${k.title}`} style={{ padding: 4 }}>
                      <Sym name="trash" size={15} color={colors.textFaint} />
                    </PressableScale>
                  </View>
                  <PressableScale onPress={() => { setEditingK(k); setKOpen(true); }} haptic="select" accessibilityRole="button" accessibilityLabel={`Edit ${k.title}`} style={{ gap: 4 }}>
                    <T kind="rowTitle">{k.title}</T>
                    {k.content ? <T kind="sub" numberOfLines={3}>{k.content}</T> : null}
                    {k.tags.length > 0 ? <T kind="caption" color={colors.textFaint}>{k.tags.map((t) => `#${t}`).join(" ")}</T> : null}
                  </PressableScale>
                </Card>
              </Rise>
            ))
          )}

          <CollapsibleSection title="Memory" count={memory.length}>
          <Rise index={1}>
            <T kind="sub">What Famili has learned from real runs. Remove anything it got wrong.</T>
          </Rise>
          {memory.length === 0 ? (
            <EmptyState icon="brain" title="No memory yet" hint="Entries appear as your agents complete runs." />
          ) : (
            memory.map((m, i) => {
              /* A11 [20:35] — "the Notes and Approved-decisions cards need more context —
               * all the available info — when they're expanded." A note said WHAT was learned
               * and never where it came from, so there was no way to judge it. Everything the
               * record actually carries is shown; nothing is invented to fill the space. */
              const openM = expandedMemory === m.id;
              const src = runs.find((r) => r.id === m.source?.runId) ?? null;
              return (
                <Rise key={m.id} index={Math.min(i + 2, 8)}>
                  <Card style={{ gap: spacing.sm }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                      <Badge label={m.type || m.scope} fg={colors.lavender} bg={colors.lavenderBg} />
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <T kind="caption" color={colors.textFaint}>{new Date(m.createdAt).toLocaleDateString()}</T>
                        <PressableScale onPress={() => confirmRemoveMemory(m)} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete memory">
                          <Sym name="trash" size={15} color={colors.textFaint} />
                        </PressableScale>
                      </View>
                    </View>
                    <PressableScale
                      onPress={() => { tapHaptic("select"); setExpandedMemory(openM ? null : m.id); }}
                      haptic={null}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: openM }}
                      accessibilityLabel={m.text}
                    >
                      <T kind="body" selectable>{m.text}</T>
                    </PressableScale>
                    {openM ? (
                      <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                        <MetaLine label="Scope" value={m.scope === "household" ? "The whole household" : m.scope} />
                        <MetaLine label="Kind" value={m.type || "note"} />
                        <MetaLine label="Learned" value={new Date(m.createdAt).toLocaleString()} />
                        <MetaLine label="From" value={src ? `the run "${src.title}"` : m.source?.runId ? "a run that has since been cleared" : "someone in the household, directly"} />
                        {src ? <RunDetail run={src} /> : null}
                      </View>
                    ) : null}
                  </Card>
                </Rise>
              );
            })
          )}
          </CollapsibleSection>

          <CollapsibleSection title="Artifacts" count={artifacts.length}>
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
                    {/* A10 — what was involved, and what didn't happen. */}
                    {open ? <RunDetail run={runs.find((r) => r.id === a.runId) ?? null} /> : null}
                  </Card>
                </Rise>
              );
            })
          )}
          </CollapsibleSection>
        </>
      )}

      <UploadSheet visible={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={(f) => { setJustUploaded(f); void load(); }} />
      <KnowledgeSheet
        item={editingK}
        visible={kOpen}
        onClose={() => setKOpen(false)}
        onSaved={() => { setKOpen(false); setEditingK(null); void load(); }}
        suggestedTags={knownTags}
      />
    </HScreen>
  );
}

/** Create / edit a knowledge item (title, type, content, tags, visibility, sensitive).
 *  New when item is null; edit PATCHes the existing record. */
function KnowledgeSheet({ item, visible, onClose, onSaved, suggestedTags = [] }: {
  item: KnowledgeRec | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** J1 — tags already in use in this household, so everyone doesn't have to remember their
   *  own spelling of "insurance". */
  suggestedTags?: string[];
}) {
  const { colors, spacing, type } = useTheme();
  const [title, setTitle] = useState("");
  const [ktype, setKtype] = useState<string>("note");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<"household" | "personal">("household");
  const [sensitive, setSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(item?.title ?? "");
    setKtype(item?.type ?? "note");
    setContent(item?.content ?? "");
    setTags((item?.tags ?? []).join(", "));
    setVisibility(item?.visibility ?? "household");
    setSensitive(item?.sensitive ?? false);
    setErr(null);
  }, [visible, item]);

  const inputStyle = [type.body, { color: colors.text, backgroundColor: colors.surfaceSunken, borderRadius: 12, borderCurve: "continuous" as const, paddingHorizontal: spacing.md, paddingVertical: 10 }];

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true); setErr(null);
    const tagList = tags.split(",").map((s) => s.trim()).filter(Boolean);
    const body = { title: title.trim(), type: ktype, content: content.trim(), tags: tagList, visibility, sensitive };
    const r = item
      ? await api.patchKnowledge(item.id, { ...body, ifUpdatedAt: item.updatedAt })
      : await api.createKnowledge(body);
    setBusy(false);
    if (r.item) { tapHaptic("success"); onSaved(); }
    else if (r.error === "stale_write") setErr("This changed on another device — close and reopen to edit.");
    else setErr(r.error === "insufficient_role" ? "Adding knowledge needs Limited Member or higher." : `Couldn't save: ${r.message ?? r.error ?? "unknown error"}`);
  };

  return (
    <HSheet
      visible={visible}
      onClose={onClose}
      title={item ? "Edit knowledge" : "New knowledge"}
      leftLabel="Cancel"
      heightPct={0.9}
      footer={<SheetCTA title={busy ? "Saving…" : item ? "Save changes" : "Add knowledge"} onPress={() => void save()} disabled={busy || !title.trim()} />}
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        {err ? <Notice text={err} ok={false} /> : null}
        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Title</T>
          <TextInput style={inputStyle} placeholder="e.g. Emma's peanut allergy" placeholderTextColor={colors.textFaint} value={title} onChangeText={setTitle} accessibilityLabel="Knowledge title" />
        </View>
        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Type</T>
          <ChipRow>
            {KTYPES.map((t) => <Chip key={t} label={t} selected={ktype === t} onPress={() => setKtype(t)} />)}
          </ChipRow>
        </View>
        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Details</T>
          <TextInput style={[inputStyle, { minHeight: 96 }]} placeholder="What should Famili remember?" placeholderTextColor={colors.textFaint} value={content} onChangeText={setContent} multiline accessibilityLabel="Knowledge details" />
        </View>
        {/* J1 [20:55] — "I don't know what the tags are for. Are they supposed to
            auto-identify what's in the images and files and categorise them? The
            comma-separated thing is confusing."

            The honest answer is no: nothing reads an image and invents tags, and a field
            labelled only "Comma-separated" told him HOW to type without ever saying WHY. So
            the label now says what a tag actually does — it's how you and the assistant find
            this later — and the field offers the tags already in use instead of asking
            everyone to remember their own spelling. */}
        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Tags</T>
          <T kind="caption" color={colors.textFaint}>
            Words to find this by later — yours and Famili&apos;s. Type a few, or tap one below.
          </T>
          <TextInput
            style={inputStyle}
            placeholder="school, medical, insurance"
            placeholderTextColor={colors.textFaint}
            value={tags}
            onChangeText={setTags}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Tags, separated by commas"
          />
          {suggestedTags.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {suggestedTags.map((tg) => {
                const chosen = tags.split(",").map((x) => x.trim().toLowerCase()).includes(tg.toLowerCase());
                return (
                  <PressableScale
                    key={tg}
                    haptic="select"
                    onPress={() => {
                      const list = tags.split(",").map((x) => x.trim()).filter(Boolean);
                      setTags(chosen
                        ? list.filter((x) => x.toLowerCase() !== tg.toLowerCase()).join(", ")
                        : [...list, tg].join(", "));
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen }}
                    accessibilityLabel={`Tag ${tg}`}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                      backgroundColor: chosen ? colors.emberBg : colors.surfaceSunken,
                    }}
                  >
                    <T kind="caption" color={chosen ? colors.ember : colors.textSecondary}>#{tg}</T>
                  </PressableScale>
                );
              })}
            </View>
          ) : null}
        </View>
        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Who can see this</T>
          <ChipRow>
            <Chip label="Everyone" selected={visibility === "household"} onPress={() => setVisibility("household")} />
            <Chip label="Just me" selected={visibility === "personal"} onPress={() => setVisibility("personal")} />
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
      </ScrollView>
    </HSheet>
  );
}

/** A11 — one labelled fact. Deliberately dull: these exist so a family can judge a note, not
 *  to be read as prose. */
function MetaLine({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <T kind="caption" color={colors.textFaint} style={{ width: 66 }}>{label}</T>
      <T kind="caption" color={colors.textSecondary} style={{ flex: 1 }}>{value}</T>
    </View>
  );
}

/**
 * A10 — "what was involved, and what went wrong and why."
 *
 * Every step of the run that produced this, the connection each one used, and — the part that
 * was missing entirely — the steps that did NOT happen, with the reason the server recorded.
 * A run summary that lists only the successes is how "3/3 finished" came to mean "nothing was
 * sent"; that lesson is what this component exists to hold onto.
 */
function RunDetail({ run }: { run: RunRec | null }) {
  const { colors, spacing } = useTheme();
  if (!run) return null;
  const steps = run.steps ?? [];
  const ok = (st: string) => ["done", "completed", "succeeded"].includes(st);
  const bad = (st: string) => ["failed", "skipped", "skipped_no_tool", "expired"].includes(st);
  // The real accounts this run touched, named from each step's tool. FamiliOS's own internal
  // functions are left out: they aren't a connection a family can lose.
  const connectors = [...new Set(steps
    .map((st) => st.toolId?.split(".")[0])
    .filter((c): c is string => !!c && c !== "homeops"))]
    .map((c) => c.replace(/[_-]+/g, " ").replace(/^\w/, (ch) => ch.toUpperCase()));
  const shortfalls = steps.filter((st) => bad(st.status));

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
      {connectors.length > 0 ? (
        <View style={{ gap: 4 }}>
          <T kind="eyebrow">What it used</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {connectors.map((c) => (
              <View key={c} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceSunken, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Sym name="link" size={10} color={colors.textFaint} />
                <T kind="caption" color={colors.textSecondary}>{c}</T>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <T kind="eyebrow">Steps</T>
        {steps.map((st, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
            <Sym
              name={ok(st.status) ? "checkmark.circle.fill" : bad(st.status) ? "exclamationmark.circle.fill" : "circle"}
              size={11}
              color={ok(st.status) ? colors.sage : bad(st.status) ? colors.amber : colors.textFaint}
              style={{ marginTop: 3 }}
            />
            <View style={{ flex: 1 }}>
              <T kind="caption" color={colors.textSecondary}>{st.title}</T>
              {/* The reason, at the same weight as the step. Burying it is how a run that
                  delivered nothing still read as a success. */}
              {bad(st.status) && st.detail ? (
                <T kind="caption" color={colors.amber}>{st.detail}</T>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {shortfalls.length === 0 ? null : (
        <T kind="caption" color={colors.amber}>
          {shortfalls.length} step{shortfalls.length === 1 ? "" : "s"} didn&apos;t happen — see the reasons above.
        </T>
      )}
    </View>
  );
}
