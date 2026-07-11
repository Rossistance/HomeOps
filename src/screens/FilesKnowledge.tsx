import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  PageHeader, Card, Button, IconButton, Badge, Tabs, Drawer, Modal, Field, TextInput, TextArea, Select, Toggle, EmptyState, Tag,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { relativeTime, fmtDate } from "@/lib/dates";
import { backend, type ServerArtifact } from "@/connectors/api";
import type { FileAsset, KnowledgeItem, KnowledgeType } from "@/types";

function fmtSize(b: number) { return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; }

export function FilesKnowledge() {
  const params = useStore((s) => s.route.params);
  const [tab, setTab] = useState("files");
  useEffect(() => { if (params?.tab) setTab(params.tab); if (params?.item) setTab("knowledge"); if (params?.file || params?.new) setTab("files"); }, [params?.tab, params?.item, params?.file, params?.new]);
  const files = useStore((s) => s.data.files);
  const knowledge = useStore((s) => s.data.knowledge);
  return (
    <div className="animate-fade-in">
      <PageHeader title="Files & Knowledge" subtitle="Documents your helpers process, plus everything they know about your household." icon="FolderOpen" />
      <Tabs tabs={[{ id: "files", label: "Files", icon: "FileText", count: files.length }, { id: "knowledge", label: "Knowledge Library", icon: "BookOpen", count: knowledge.length }]} active={tab} onChange={setTab} />
      <div className="pt-5">{tab === "files" ? <Files /> : <Knowledge />}</div>
    </div>
  );
}

/* -------------------------------- Files --------------------------------- */

function Files() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const uploadFiles = useStore((s) => s.uploadFiles);
  const [folder, setFolder] = useState("All");
  const [spaceId, setSpaceId] = useState("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [idOpen, setIdOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (params?.file) setSelected(params.file); if (params?.new) inputRef.current?.click(); }, [params?.file, params?.new]);

  const folders = useMemo(() => ["All", ...Array.from(new Set(data.files.map((f) => f.folder)))], [data.files]);
  const files = data.files.filter((f) =>
    (folder === "All" || f.folder === folder) &&
    (spaceId === "all" || f.spaceId === spaceId) &&
    (!q || f.name.toLowerCase().includes(q.toLowerCase()) || f.tags.some((t) => t.toLowerCase().includes(q.toLowerCase()))),
  );
  const sel = data.files.find((f) => f.id === selected) ?? null;

  const onPick = async (list: FileList | null) => { if (list && list.length) await uploadFiles(Array.from(list)); };

  return (
    <div>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 sm:flex-1">
          <div className="relative flex-1"><Icon name="Search" size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-ink-400" /><TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files & tags…" className="pl-8" /></div>
          <Select value={folder} onChange={(e) => setFolder(e.target.value)} className="!w-auto">{folders.map((f) => <option key={f} value={f}>{f}</option>)}</Select>
          <Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} className="!w-auto"><option value="all">All spaces</option>{data.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setIdOpen(true)}><Icon name="IdCard" size={16} /> ID (front & back)</Button>
          <Button variant="ember" onClick={() => inputRef.current?.click()}><Icon name="Upload" size={16} /> Upload</Button>
        </div>
      </div>

      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files); }} className="well mb-4 border-dashed px-4 py-3 text-center text-sm text-ink-400">
        <Icon name="UploadCloud" size={18} className="mr-2 inline" /> Drag & drop files here — helpers will summarize them and detect dates & tasks.
      </div>

      {files.length === 0 ? <EmptyState icon="FileUp" title="No files" message="Upload a document to get started." action={<Button variant="ember" onClick={() => inputRef.current?.click()}>Upload</Button>} /> : (
        <div className="stagger grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {files.map((f) => (
            <Card key={f.id} className="card-pad flex flex-col" hover onClick={() => setSelected(f.id)}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={f.type === "Image" ? "Image" : f.type === "CSV" || f.type === "XLSX" ? "Table" : "FileText"} size={20} /></span>
                <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink-900">{f.name}</p><p className="text-xs text-ink-400">{f.type} · {fmtSize(f.sizeBytes)} · {relativeTime(f.uploadedAt)}</p></div>
                {f.sensitive && <Icon name="Lock" size={14} className="text-lavender-600" />}
              </div>
              {f.summary && <p className="mt-2 line-clamp-2 text-xs text-ink-500">{f.summary}</p>}
              <div className="mt-2 flex flex-wrap gap-1">{f.tags.slice(0, 3).map((t) => <Tag key={t}>{t}</Tag>)}{f.detectedTasks.length > 0 && <span className="chip bg-sky-100 text-sky-600">{f.detectedTasks.length} tasks</span>}{f.detectedDates.length > 0 && <span className="chip bg-sage-100 text-sage-600">{f.detectedDates.length} dates</span>}</div>
            </Card>
          ))}
        </div>
      )}
      {sel && <FileDrawer file={sel} onClose={() => setSelected(null)} />}
      {idOpen && <IdCardModal spaceId={spaceId === "all" ? undefined : spaceId} onClose={() => setIdOpen(false)} />}
    </div>
  );
}

/** Capture the front AND back of an ID card (or any 2-sided document) and store them as ONE
 *  durable, multi-page file — not two separate uploads. */
function IdCardModal({ spaceId, onClose }: { spaceId?: string; onClose: () => void }) {
  const uploadIdCard = useStore((s) => s.uploadIdCard);
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!front || !back) return;
    setBusy(true);
    await uploadIdCard(front, back, name.trim() || undefined, spaceId);
    setBusy(false);
    onClose();
  };
  const SidePicker = ({ label, file, onPick }: { label: string; file: File | null; onPick: (f: File | null) => void }) => (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-900/15 bg-surface-sunken/60 px-4 py-6 text-center transition-colors hover:border-ember-300">
      <Icon name={file ? "CheckCircle2" : "ImagePlus"} size={22} className={file ? "text-sage-500" : "text-ink-400"} />
      <span className="text-sm font-semibold text-ink-700">{label}</span>
      <span className="max-w-[10rem] truncate text-xs text-ink-400">{file ? file.name : "Choose an image"}</span>
      <input type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
  return (
    <Modal open onClose={onClose} title="Upload ID (front & back)" icon="IdCard" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="ember" disabled={!front || !back || busy} onClick={save}><Icon name={busy ? "Loader2" : "Check"} size={15} className={busy ? "animate-spin" : ""} /> Save as one document</Button></>}>
      <div className="space-y-3">
        <Field label="Document name" hint="e.g. Driver's license, Insurance card"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Driver's license" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <SidePicker label="Front" file={front} onPick={setFront} />
          <SidePicker label="Back" file={back} onPick={setBack} />
        </div>
        <p className="text-xs text-ink-400">Both sides are stored as pages of a single, sensitive file — kept in your household Library.</p>
      </div>
    </Modal>
  );
}

function FileDrawer({ file: f, onClose }: { file: FileAsset; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const process = useStore((s) => s.processFileById);
  const toggleSensitive = useStore((s) => s.toggleFileSensitive);
  const del = useStore((s) => s.deleteFile);
  const updateFile = useStore((s) => s.updateFile);
  const requestApproval = useStore((s) => s.requestApproval);
  const [tag, setTag] = useState("");
  const [backUrl, setBackUrl] = useState<string | null>(null);
  const [loadingBack, setLoadingBack] = useState(false);
  const owner = data.members.find((m) => m.id === f.ownerMemberId);
  const space = data.spaces.find((s) => s.id === f.spaceId);
  const agents = data.agents.filter((a) => f.linkedAgentIds.includes(a.id));
  const multiPage = (f.pageCount ?? 1) > 1 && !!f.serverId;
  const showBack = async () => {
    if (!f.serverId) return;
    setLoadingBack(true);
    const r = await backend.fileContent(f.serverId, 1);
    setLoadingBack(false);
    if (r.contentBase64) setBackUrl(`data:${r.mime ?? "image/jpeg"};base64,${r.contentBase64}`);
  };

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={f.name} icon="FileText"
      footer={<>
        <Button variant="ghost" onClick={() => del(f.id)}><Icon name="Trash2" size={15} /> Delete</Button>
        {f.sensitive && <Button variant="secondary" onClick={() => requestApproval({ title: `Share ${f.name}`, proposedAction: `Share sensitive file: ${f.name}`, riskLevel: "Sensitive", category: "File", spaceId: f.spaceId, previewContent: "Sharing a sensitive file outside the household requires approval." })}><Icon name="Share2" size={15} /> Request to share</Button>}
        <Button variant="primary" onClick={() => process(f.id)}><Icon name="Sparkles" size={15} /> Process</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="gray">{f.type}</Badge><Badge color="gray">{fmtSize(f.sizeBytes)}</Badge>
          <Badge color={f.searchIndexed ? "sage" : "amber"}>{f.searchIndexed ? "Indexed" : "Not indexed"}</Badge>
          {f.sensitive && <Badge color="lavender"><Icon name="Lock" size={11} /> Sensitive</Badge>}
          <div className="ml-auto flex items-center gap-2 text-sm"><span className="text-ink-500">Sensitive</span><Toggle checked={f.sensitive} onChange={() => toggleSensitive(f.id)} /></div>
        </div>

        {f.dataUrl && f.type === "Image" ? <img src={f.dataUrl} alt={f.name} className="max-h-72 w-full rounded-2xl border border-ink-900/[0.06] object-contain" /> : f.previewContent ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl bg-ink-900 p-3 text-xs text-sage-100 shadow-e1">{f.previewContent}</pre>
        ) : (
          <div className="well flex h-32 items-center justify-center border-dashed text-ink-400"><Icon name="FileText" size={28} /></div>
        )}
        {multiPage && (
          <div className="space-y-2">
            {backUrl ? <img src={backUrl} alt={`${f.name} — back`} className="max-h-72 w-full rounded-2xl border border-ink-900/[0.06] object-contain" /> : (
              <Button variant="secondary" size="sm" disabled={loadingBack} onClick={showBack}><Icon name={loadingBack ? "Loader2" : "FlipHorizontal2"} size={14} className={loadingBack ? "animate-spin" : ""} /> {loadingBack ? "Loading…" : `Show back (page 2 of ${f.pageCount})`}</Button>
            )}
          </div>
        )}

        {f.summary && <Block label="Summary">{f.summary}</Block>}
        {f.detectedDates.length > 0 && <Block label="Detected dates">{f.detectedDates.map((d, i) => <span key={i} className="chip bg-sage-100 text-sage-600 mr-1">{fmtDate(d)}</span>)}</Block>}
        {f.detectedTasks.length > 0 && <Block label="Detected tasks"><ul className="space-y-0.5">{f.detectedTasks.map((t, i) => <li key={i} className="flex items-start gap-2 text-sm text-ink-600"><Icon name="CheckSquare" size={13} className="mt-0.5 text-sky-500" />{t}</li>)}</ul></Block>}
        {f.detectedReceipts && f.detectedReceipts.length > 0 && (
          <Block label="Detected receipts"><div className="overflow-x-auto"><table className="w-full text-sm"><tbody>{f.detectedReceipts.map((r, i) => <tr key={i} className="border-b border-ink-900/[0.06]"><td className="py-1">{r.vendor}</td><td className="py-1 text-ink-500">{fmtDate(r.date)}</td><td className="py-1 text-right">${r.amount}</td><td className="py-1 pl-2">{r.needsReview ? <Badge color="amber">review</Badge> : <Badge color="sage">{r.category}</Badge>}</td></tr>)}</tbody></table></div></Block>
        )}

        <Block label="Details">
          <div className="grid grid-cols-2 gap-2 text-sm text-ink-600">
            <span>Owner: {owner?.displayName}</span><span>Space: {space?.name}</span><span>Folder: {f.folder}</span><span>Uploaded: {fmtDate(f.uploadedAt)}</span>
          </div>
        </Block>

        {agents.length > 0 && <Block label="Linked agents"><div className="flex flex-wrap gap-2">{agents.map((a) => <button key={a.id} onClick={() => navigate("agents", { id: a.id })} className="chip bg-surface-sunken text-ink-600 transition-colors hover:bg-surface-overlay"><Icon name={a.icon} size={12} /> {a.name}</button>)}</div></Block>}

        <Block label="Tags">
          <div className="flex flex-wrap items-center gap-1.5">
            {f.tags.map((t) => <span key={t} className="chip bg-surface-sunken text-ink-600">{t} <button onClick={() => updateFile(f.id, { tags: f.tags.filter((x) => x !== t) })}><Icon name="X" size={11} /></button></span>)}
            <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tag.trim()) { updateFile(f.id, { tags: [...f.tags, tag.trim()] }); setTag(""); } }} placeholder="+ tag" className="w-20 rounded-xl border border-ink-900/10 bg-surface-rim px-2 py-0.5 text-xs focus:border-ember-400/60 focus:outline-none focus:ring-2 focus:ring-[rgba(210,122,53,0.28)]" />
          </div>
        </Block>
      </div>
    </Drawer>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="section-title mb-1">{label}</p><div className="text-sm text-ink-700">{children}</div></div>;
}

/* ------------------------------ Knowledge ------------------------------- */

const KTYPES: KnowledgeType[] = ["Custom Instruction", "Family Fact", "Preference", "Important Contact", "Template", "Rule", "Saved Answer", "Reference Note"];

// Item 15: real generated artifacts (briefings/reports/run summaries) written by runs —
// server-owned, read-only here. Previously backend.artifacts() existed but NOTHING
// called it, which is why the knowledge library always looked empty.
function GeneratedArtifacts() {
  const [artifacts, setArtifacts] = useState<ServerArtifact[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { void backend.artifacts().then(setArtifacts); }, []);
  if (!artifacts.length) return null;
  return (
    <div>
      <p className="section-title mb-2.5">Generated reports & briefings</p>
      <div className="stagger grid grid-cols-1 gap-3 md:grid-cols-2">
        {artifacts.map((a) => (
          <Card key={a.id} className="card-pad">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-ink-900">{a.title}</p>
              <Badge color="sky">{a.kind.replace(/_/g, " ")}</Badge>
            </div>
            <p className={`mt-1 whitespace-pre-wrap text-sm text-ink-600 ${openId === a.id ? "" : "line-clamp-3"}`}>{a.body || "(no content)"}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-ink-400">
              <span>{new Date(a.createdAt).toLocaleString()}{a.runId ? " · from a run" : ""}</span>
              {(a.body?.length ?? 0) > 200 && <button className="font-medium text-ink-600 underline" onClick={() => setOpenId(openId === a.id ? null : a.id)}>{openId === a.id ? "Collapse" : "Read all"}</button>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Knowledge() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const del = useStore((s) => s.deleteKnowledgeItem);
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (params?.item) { const k = data.knowledge.find((x) => x.id === params.item); if (k) setEditing(k); } }, [params?.item]);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 rounded-2xl border border-lavender-200/70 bg-lavender-50 px-3 py-2 text-sm text-lavender-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"><Icon name="Lock" size={14} className="shrink-0" /> Sensitive items stay within their space (the Sensitive Info Vault).</div>
        <Button variant="ember" onClick={() => setCreating(true)}><Icon name="Plus" size={16} /> New item</Button>
      </div>
      <div className="space-y-6">
        <GeneratedArtifacts />
        {KTYPES.map((type) => {
          const items = data.knowledge.filter((k) => k.type === type);
          if (!items.length) return null;
          return (
            <div key={type}>
              <p className="section-title mb-2.5">{type}</p>
              <div className="stagger grid grid-cols-1 gap-3 md:grid-cols-2">
                {items.map((k) => (
                  <Card key={k.id} className="card-pad">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-ink-900">{k.title}</p>
                      <div className="flex gap-1">{k.sensitive && <Badge color="lavender"><Icon name="Lock" size={11} /></Badge>}<IconButton icon="Pencil" label="Edit" onClick={() => setEditing(k)} /><IconButton icon="Trash2" label="Delete" onClick={() => del(k.id)} /></div>
                    </div>
                    <p className="mt-1 text-sm text-ink-600">{k.content}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
                      <span>{data.spaces.find((s) => s.id === k.spaceId)?.name}</span><span>·</span><span>by {k.createdBy}</span>{k.agentReadable && <Badge color="sky">Agent-readable</Badge>}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {(editing || creating) && <KnowledgeModal item={editing} onClose={() => { setEditing(null); setCreating(false); }} />}
    </div>
  );
}

function KnowledgeModal({ item, onClose }: { item: KnowledgeItem | null; onClose: () => void }) {
  const spaces = useStore((s) => s.data.spaces);
  const create = useStore((s) => s.createKnowledgeItem);
  const update = useStore((s) => s.updateKnowledgeItem);
  const [title, setTitle] = useState(item?.title ?? "");
  const [type, setType] = useState<KnowledgeType>(item?.type ?? "Family Fact");
  const [content, setContent] = useState(item?.content ?? "");
  const [spaceId, setSpaceId] = useState(item?.spaceId ?? spaces[0]?.id ?? "");
  const [sensitive, setSensitive] = useState(item?.sensitive ?? false);
  const submit = () => {
    if (!title.trim()) return;
    if (item) update(item.id, { title, type, content, spaceId, sensitive });
    else create({ title, type, content, spaceId, sensitive });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={item ? "Edit knowledge item" : "New knowledge item"} icon="BookOpen" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim()} onClick={submit}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as KnowledgeType)}>{KTYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Space"><Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        </div>
        <Field label="Content"><TextArea value={content} onChange={(e) => setContent(e.target.value)} /></Field>
        <div className="flex items-center gap-2"><Toggle checked={sensitive} onChange={setSensitive} /><span className="text-sm text-ink-700">Mark as sensitive</span></div>
      </div>
    </Modal>
  );
}
