import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, IconButton, Badge, Avatar, Tabs, Drawer, Modal, Field, TextInput, TextArea, Select, Toggle, EmptyState, ACCENT_BG, ACCENT_SOLID } from "@/components/ui";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/Icon";
import { backend, type ServerMember, type ServerContactMethod } from "@/connectors/api";
import { MemberAvatar } from "@/components/MemberAvatar";
import { isChild } from "@/lib/roles";
import type { Role, Space, SpaceType } from "@/types";

/* Members are SERVER-owned (same registry the iOS app writes to) — the local
 * store is only used for spaces. This hook is the single source of truth for
 * the roster so the web and mobile views can never drift apart again. */
const AVATAR_ACCENTS = ["ember", "sage", "sky", "lavender", "amber", "ink"] as const;
const avatarColor = (name: string) => AVATAR_ACCENTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_ACCENTS.length];
// The six selectable member colors (map to the shared accent palette used for avatars,
// calendar dots, and badges). Kept in sync with the server's accepted color names.
const MEMBER_COLORS = ["ink", "sage", "coral", "amber", "sky", "lavender"] as const;
const initialsOf = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function useServerMembers() {
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [methods, setMethods] = useState<ServerContactMethod[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const [m, cm] = await Promise.all([backend.members(), backend.contactMethods()]);
    setMembers(m);
    setMethods(cm);
    setLoaded(true);
    if (m.length === 0) setError("Couldn't load the household roster from the server.");
    else setError(null);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { members, methods, loaded, error, reload, setError };
}

const ROLES: Role[] = ["Owner", "Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"];
const SPACE_TYPES: SpaceType[] = ["Personal", "Family", "School", "Bills", "Medical", "Travel", "Home Maintenance", "Caregiving", "Pets", "Custom"];

const ROLE_ACCESS: { role: Role; icon: string; desc: string }[] = [
  { role: "Owner", icon: "Crown", desc: "Full access to household settings, members, spaces, agents, connections, knowledge — and deletion." },
  { role: "Adult Admin", icon: "ShieldCheck", desc: "Manage most household resources, except deleting the household or changing owner-level settings." },
  { role: "Adult Member", icon: "User", desc: "Use shared agents, create tasks, respond to assigned approvals, and access allowed spaces." },
  { role: "Limited Member", icon: "UserMinus", desc: "View and respond to assigned items only." },
  { role: "Child View", icon: "Baby", desc: "See age-appropriate chores, schedule items, and messages only." },
  { role: "Guest/Helper", icon: "UserPlus", desc: "Access specific shared spaces or tasks only." },
];

export function HouseholdSpaces() {
  const params = useStore((s) => s.route.params);
  const [tab, setTab] = useState("spaces");
  useEffect(() => { if (params?.tab && ["spaces", "members", "roles"].includes(params.tab)) setTab(params.tab); if (params?.member || params?.new) setTab("members"); if (params?.space) setTab("spaces"); }, [params?.tab, params?.member, params?.space, params?.new]);
  return (
    <div className="animate-fade-in">
      <PageHeader title="Household Spaces" subtitle="Members, shared spaces, and who can access what." icon="Users" />
      <Tabs tabs={[{ id: "spaces", label: "Spaces", icon: "FolderOpen" }, { id: "members", label: "Members", icon: "Users" }, { id: "roles", label: "Roles & Access", icon: "ShieldCheck" }]} active={tab} onChange={setTab} />
      <div className="pt-5">{tab === "spaces" ? <Spaces /> : tab === "members" ? <Members /> : <RolesView />}</div>
    </div>
  );
}

const ACCENTS = ["ink", "sage", "coral", "amber", "sky", "lavender"] as const;

function Spaces() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (params?.space) setSelected(params.space); }, [params?.space]);
  const sel = data.spaces.find((s) => s.id === selected) ?? null;

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button variant="ember" onClick={() => setCreating(true)}><Icon name="Plus" size={16} /> New space</Button></div>
      <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.spaces.map((s) => (
          <Card key={s.id} className="card-pad" hover onClick={() => setSelected(s.id)}>
            <div className="flex items-start gap-3">
              <span className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${ACCENT_BG[s.accent] ?? ACCENT_BG.gray}`} style={{}}><Icon name={s.icon} size={22} /></span>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="font-display truncate text-lg font-semibold text-ink-900">{s.name}</p>{s.sensitive && <Icon name="Lock" size={13} className="text-lavender-600" />}</div><p className="line-clamp-2 text-xs text-ink-500">{s.description}</p></div>
            </div>
            <div className="mt-4 flex items-center gap-4 border-t border-ink-900/[0.06] pt-3 text-xs text-ink-500">
              <span className="flex items-center gap-1"><Icon name="Users" size={12} /> {s.memberIds.length}</span>
              <span className="flex items-center gap-1"><Icon name="Bot" size={12} /> {s.agentIds.length}</span>
              <span className="flex items-center gap-1"><Icon name="Plug" size={12} /> {s.connectionIds.length}</span>
              <Badge color="gray" className="ml-auto">{s.type}</Badge>
            </div>
          </Card>
        ))}
      </div>
      {sel && <SpaceDrawer space={sel} onClose={() => setSelected(null)} />}
      {creating && <SpaceModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function SpaceDrawer({ space, onClose }: { space: Space; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const toggleMember = useStore((s) => s.toggleSpaceMember);
  const updateSpace = useStore((s) => s.updateSpace);
  const del = useStore((s) => s.deleteSpace);
  const [name, setName] = useState(space.name);
  const [desc, setDesc] = useState(space.description);
  const agents = data.agents.filter((a) => space.agentIds.includes(a.id));
  const allConnectors = useStore((s) => s.connectors);
  const connections = allConnectors.filter((c) => space.connectionIds.includes(c.id));

  return (
    <Drawer open onClose={onClose} width="max-w-xl" title={space.name} icon={space.icon}
      footer={<><Button variant="danger" onClick={() => { del(space.id); onClose(); }}><Icon name="Trash2" size={15} /> Delete</Button><Button variant="primary" onClick={() => updateSpace(space.id, { name, description: desc })}><Icon name="Save" size={15} /> Save</Button></>}>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3"><Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Description"><TextArea value={desc} onChange={(e) => setDesc(e.target.value)} /></Field></div>
        <div>
          <p className="section-title mb-2">Members</p>
          <div className="space-y-1.5">{data.members.map((m) => (
            <div key={m.id} className="data-row">
              <span className="flex items-center gap-2 text-sm"><MemberAvatar initials={m.initials} color={m.avatarColor} photoFileId={m.photoFileId} size={26} /> {m.displayName} <span className="text-xs text-ink-400">{m.role}</span></span>
              <Toggle checked={space.memberIds.includes(m.id)} onChange={() => toggleMember(space.id, m.id)} />
            </div>
          ))}</div>
        </div>
        {agents.length > 0 && <div><p className="section-title mb-2">Agents</p><div className="flex flex-wrap gap-2">{agents.map((a) => <button key={a.id} onClick={() => navigate("agents", { id: a.id })} className="chip bg-surface-sunken text-ink-600 transition-colors hover:bg-ink-900/[0.06]"><Icon name={a.icon} size={12} /> {a.name}</button>)}</div></div>}
        {connections.length > 0 && <div><p className="section-title mb-2">Connections</p><div className="flex flex-wrap gap-2">{connections.map((c) => <span key={c.id} className="chip bg-surface-sunken text-ink-600"><Icon name="Plug" size={12} /> {c.name}</span>)}</div></div>}
      </div>
    </Drawer>
  );
}

function SpaceModal({ onClose }: { onClose: () => void }) {
  const create = useStore((s) => s.createSpace);
  const [name, setName] = useState("");
  const [type, setType] = useState<SpaceType>("Custom");
  const [desc, setDesc] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [accent, setAccent] = useState<(typeof ACCENTS)[number]>("ink");
  return (
    <Modal open onClose={onClose} title="New space" icon="FolderPlus" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => { create({ name, type, description: desc, sensitive, accent, icon: "Folder" }); onClose(); }}>Create</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as SpaceType)}>{SPACE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field><Field label="Accent"><Select value={accent} onChange={(e) => setAccent(e.target.value as (typeof ACCENTS)[number])}>{ACCENTS.map((a) => <option key={a}>{a}</option>)}</Select></Field></div>
        <Field label="Description"><TextArea value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <div className="flex items-center gap-2"><Toggle checked={sensitive} onChange={setSensitive} /><span className="text-sm text-ink-700">Sensitive space</span></div>
      </div>
    </Modal>
  );
}

function Members() {
  const { members, methods, loaded, error, reload, setError } = useServerMembers();
  const params = useStore((s) => s.route.params);
  const [creating, setCreating] = useState(false);
  // The command palette's "Add family member" navigates with {new:"1"} — open the form.
  useEffect(() => { if (params?.new) setCreating(true); }, [params?.new]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const friendly = (e?: string, msg?: string) =>
    msg ?? (e === "insufficient_role" ? "Only an Owner or Adult Admin can do that."
      : e === "last_owner" ? "The household needs at least one Owner."
      : e === "cannot_archive_self" ? "You can't remove the profile you're signed in as."
      : "Something went wrong — try again.");

  const changeRole = async (m: ServerMember, role: string) => {
    setBusyId(m.actorId); setError(null);
    const r = await backend.updateMemberRemote(m.actorId, { role });
    setBusyId(null);
    if (r.error) setError(friendly(r.error, r.message));
    await reload();
  };

  const remove = async (m: ServerMember) => {
    if (!window.confirm(`Remove ${m.displayName} from the household? Their profile disappears from every device and any invite they received stops working.`)) return;
    setBusyId(m.actorId); setError(null);
    const r = await backend.archiveMemberRemote(m.actorId);
    setBusyId(null);
    if (r.error) setError(friendly(r.error, r.message));
    await reload();
  };

  // Per-member color — durable on the server, so each family member's calendar items and
  // avatars are color-coded consistently across web and iOS.
  const changeColor = async (m: ServerMember, color: string) => {
    setBusyId(m.actorId); setError(null);
    const r = await backend.updateMemberRemote(m.actorId, { color });
    setBusyId(null);
    if (r.error) setError(friendly(r.error, r.message));
    await reload();
  };

  // Display name / relationship / per-child AI toggle — all through the same server
  // member registry (self-edit of name is allowed; the rest is Owner/Adult Admin gated,
  // and the server's `last_owner` guard is surfaced via friendly()).
  const patchMember = async (m: ServerMember, patch: { displayName?: string; relationship?: string | null; aiEnabled?: boolean }) => {
    setBusyId(m.actorId); setError(null);
    const r = await backend.updateMemberRemote(m.actorId, patch);
    setBusyId(null);
    if (r.error) setError(friendly(r.error, r.message));
    await reload();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-500">The roster is shared with the iOS app — changes here show up there instantly, and vice versa.</p>
        <Button variant="ember" onClick={() => setCreating(true)}><Icon name="UserPlus" size={16} /> Add member</Button>
      </div>
      {error && <div className="mb-4 rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-600">{error}</div>}
      {!loaded ? (
        <p className="text-sm text-ink-500">Loading the household…</p>
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2">
          {members.map((m) => (
            <MemberCard key={m.actorId} m={m} methods={methods.filter((c) => c.memberId === m.actorId)} busy={busyId === m.actorId}
              onChangeRole={changeRole} onChangeColor={changeColor} onPatch={patchMember} onRemove={remove} />
          ))}
        </div>
      )}
      {creating && <MemberModal onClose={() => setCreating(false)} onCreated={() => void reload()} />}
    </div>
  );
}

function MemberCard({ m, methods, busy, onChangeRole, onChangeColor, onPatch, onRemove }: {
  m: ServerMember;
  methods: ServerContactMethod[];
  busy: boolean;
  onChangeRole: (m: ServerMember, role: string) => Promise<void>;
  onChangeColor: (m: ServerMember, color: string) => Promise<void>;
  onPatch: (m: ServerMember, patch: { displayName?: string; relationship?: string | null; aiEnabled?: boolean }) => Promise<void>;
  onRemove: (m: ServerMember) => Promise<void>;
}) {
  const [name, setName] = useState(m.displayName);
  const [rel, setRel] = useState(m.relationship ?? "");
  const dirty = name.trim() !== m.displayName || rel.trim() !== (m.relationship ?? "");
  const childView = m.role === "Child View" || isChild({ role: m.role, relationship: m.relationship });
  const color = m.color ?? avatarColor(m.displayName);

  return (
    <Card className="card-pad">
      <div className="flex items-start gap-3">
        <MemberAvatar initials={initialsOf(m.displayName)} color={color} photoFileId={m.photoFileId} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><p className="font-display text-lg font-semibold text-ink-900">{m.displayName}</p>{m.isCurrentUser && <Badge color="sky">You</Badge>}</div>
          <p className="text-xs text-ink-500">{m.relationship ?? m.role}</p>
        </div>
        {!m.isCurrentUser && m.role !== "Owner" && (
          <IconButton icon="Trash2" label={`Remove ${m.displayName}`} onClick={() => void onRemove(m)} />
        )}
      </div>
      <div className="mt-3 space-y-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Display name"><TextInput value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></Field>
          <Field label="Relationship"><TextInput value={rel} onChange={(e) => setRel(e.target.value)} placeholder="Parent, child, grandparent…" disabled={busy} /></Field>
        </div>
        {dirty && (
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={() => void onPatch(m, { displayName: name.trim(), relationship: rel.trim() || null })}><Icon name="Save" size={13} /> Save</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setName(m.displayName); setRel(m.relationship ?? ""); }}>Cancel</Button>
          </div>
        )}
        <Field label="Calendar color">
          <div className="flex flex-wrap items-center gap-2">
            {MEMBER_COLORS.map((c) => {
              const active = color === c;
              return (
                <button key={c} onClick={() => void onChangeColor(m, c)} disabled={busy} aria-label={`Set ${m.displayName}'s color to ${c}`} aria-pressed={active}
                  className={cn("h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-surface-raised transition-transform hover:scale-110", ACCENT_SOLID[c], active ? "ring-ink-700" : "ring-transparent")} />
              );
            })}
          </div>
        </Field>
        <Field label="Role">
          <Select value={m.role} onChange={(e) => void onChangeRole(m, e.target.value)} disabled={m.role === "Owner" || busy}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        {childView && (
          <div className="flex items-center justify-between rounded-xl border border-lavender-200/70 bg-lavender-50/60 px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-ink-800">AI chat</p>
              <p className="text-xs text-ink-500">{m.aiEnabled ? "Can ask FamiliOS questions." : "Assistant is off for this child."}</p>
            </div>
            <Toggle checked={!!m.aiEnabled} onChange={(v) => void onPatch(m, { aiEnabled: v })} />
          </div>
        )}
        <div className="well space-y-1.5 px-3 py-2.5">
          <div className="text-xs text-ink-500"><span className="font-semibold text-ink-600">Contact:</span> {methods.length ? methods.map((c) => `${c.label} (${c.type})`).join(", ") : "none yet"}</div>
        </div>
      </div>
    </Card>
  );
}

function MemberModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Adult Member");
  const [rel, setRel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    const r = await backend.createMemberRemote({ displayName: name.trim(), role, relationship: rel.trim() || null });
    setBusy(false);
    if (r.error) {
      setError(r.error === "insufficient_role" ? "Only an Owner or Adult Admin can add members."
        : r.error === "actor_exists" ? "Someone with that profile already exists."
        : r.message ?? "Couldn't add the member — try again.");
      return;
    }
    onCreated();
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add member" icon="UserPlus" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>{busy ? "Adding…" : "Add"}</Button></>}>
      <div className="space-y-3">
        {error && <div className="rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-600">{error}</div>}
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Relationship"><TextInput value={rel} onChange={(e) => setRel(e.target.value)} placeholder="Parent, child, grandparent, caregiver…" /></Field>
      </div>
    </Modal>
  );
}

function RolesView() {
  const { members: serverMembers } = useServerMembers();
  const members = serverMembers.map((m) => ({ id: m.actorId, displayName: m.displayName, role: m.role as Role, initials: initialsOf(m.displayName), avatarColor: avatarColor(m.displayName) }));
  return (
    <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2">
      {ROLE_ACCESS.map((r) => (
        <Card key={r.role} className="card-pad">
          <div className="mb-2 flex items-center gap-2.5"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-100 text-ink-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={r.icon} size={18} /></span><p className="font-display text-lg font-semibold text-ink-900">{r.role}</p></div>
          <p className="text-sm text-ink-600">{r.desc}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{members.filter((m) => m.role === r.role).map((m) => <span key={m.id} className="chip bg-surface-sunken text-ink-600"><Avatar initials={m.initials} color={m.avatarColor} size={16} /> {m.displayName.split(" ")[0]}</span>)}</div>
        </Card>
      ))}
    </div>
  );
}
