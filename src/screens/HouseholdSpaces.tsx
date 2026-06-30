import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, IconButton, Badge, Avatar, Tabs, Drawer, Modal, Field, TextInput, TextArea, Select, Toggle, EmptyState, ACCENT_BG } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { Role, Space, SpaceType } from "@/types";

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
  useEffect(() => { if (params?.tab && ["spaces", "members", "roles"].includes(params.tab)) setTab(params.tab); if (params?.member) setTab("members"); if (params?.space) setTab("spaces"); }, [params?.tab, params?.member, params?.space]);
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
              <span className="flex items-center gap-2 text-sm"><Avatar initials={m.initials} color={m.avatarColor} size={26} /> {m.displayName} <span className="text-xs text-ink-400">{m.role}</span></span>
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
  const data = useStore((s) => s.data);
  const updateMember = useStore((s) => s.updateMember);
  const del = useStore((s) => s.deleteMember);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button variant="ember" onClick={() => setCreating(true)}><Icon name="UserPlus" size={16} /> Add member</Button></div>
      <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.members.map((m) => {
          const methods = data.contactMethods.filter((c) => c.memberId === m.id);
          const spaceNames = data.spaces.filter((s) => m.spaceIds.includes(s.id)).map((s) => s.name);
          return (
            <Card key={m.id} className="card-pad">
              <div className="flex items-start gap-3">
                <Avatar initials={m.initials} color={m.avatarColor} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><p className="font-display text-lg font-semibold text-ink-900">{m.displayName}</p>{m.isCurrentUser && <Badge color="sky">You</Badge>}</div>
                  <p className="text-xs text-ink-500">{m.relationship}</p>
                </div>
                {!m.isCurrentUser && m.role !== "Owner" && <IconButton icon="Trash2" label="Remove" onClick={() => del(m.id)} />}
              </div>
              <div className="mt-3 space-y-2">
                <Field label="Role"><Select value={m.role} onChange={(e) => updateMember(m.id, { role: e.target.value as Role })} disabled={m.role === "Owner"}>{ROLES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
                <div className="well space-y-1.5 px-3 py-2.5">
                  <div className="text-xs text-ink-500"><span className="font-semibold text-ink-600">Spaces:</span> {spaceNames.join(", ") || "—"}</div>
                  <div className="text-xs text-ink-500"><span className="font-semibold text-ink-600">Contact:</span> {methods.length ? methods.map((c) => c.label).join(", ") : "none"}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {creating && <MemberModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function MemberModal({ onClose }: { onClose: () => void }) {
  const create = useStore((s) => s.createMember);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Adult Member");
  const [rel, setRel] = useState("");
  return (
    <Modal open onClose={onClose} title="Add member" icon="UserPlus" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => { create({ displayName: name, role, relationship: rel }); onClose(); }}>Add</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Relationship"><TextInput value={rel} onChange={(e) => setRel(e.target.value)} placeholder="Parent, child, caregiver…" /></Field>
      </div>
    </Modal>
  );
}

function RolesView() {
  const members = useStore((s) => s.data.members);
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
