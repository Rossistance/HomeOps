import { useState, useEffect, type ReactNode } from "react";
import { useStore } from "@/store/useStore";
import { brand } from "@/brand";
import { Icon } from "./Icon";
import { cn } from "@/lib/cn";
import { Avatar } from "./ui";
import { useCalmMode, useAdvancedMode } from "@/lib/prefs";
import type { ScreenId } from "@/types";

/** Calm Mode — stills motion, flattens depth, softens color for lower sensory load. */
function CalmToggle() {
  const [calm, setCalm] = useCalmMode();
  return (
    <button
      onClick={() => setCalm(!calm)}
      role="switch"
      aria-checked={calm}
      aria-label="Calm Mode — reduce motion, depth, and color"
      title={calm ? "Calm Mode is on — tap to restore full motion & depth" : "Calm Mode — reduce motion, depth & color"}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-xl border px-2.5 text-sm font-medium transition-colors",
        calm
          ? "border-ember-200 bg-ember-50 text-ember-600"
          : "border-transparent text-ink-500 hover:bg-ink-900/[0.05]",
      )}
    >
      <Icon name="Waves" size={18} />
      <span className="hidden sm:inline">Calm</span>
    </button>
  );
}

interface NavItem { id: ScreenId; label: string; icon: string; advanced?: boolean }
interface NavGroup { label: string; items: NavItem[] }

// Skills/Functions are the low-level building blocks agents & automations compile down
// to. They're hidden by default (Advanced Mode, off in Settings) so new households see
// only Ask FamiliOS, Agents, Automations, and Mini Apps. Playbooks folded into Skills as
// a read-only "Recipes" tab rather than staying a separate top-level concept.
export const NAV_GROUPS: NavGroup[] = [
  { label: "Command Center", items: [
    { id: "dashboard", label: "Home", icon: "LayoutDashboard" },
    { id: "assistant", label: "Ask FamiliOS", icon: "Sparkles" },
    { id: "calendar", label: "Calendar", icon: "CalendarDays" },
  ] },
  { label: "Agents & Workflows", items: [
    { id: "agents", label: "Helper Agents", icon: "Bot" },
    { id: "automations", label: "Automations", icon: "Workflow" },
    { id: "skills", label: "Skills", icon: "Layers", advanced: true },
    { id: "functions", label: "Functions", icon: "FunctionSquare", advanced: true },
  ] },
  { label: "Family Systems", items: [
    { id: "messages", label: "Messages & Approvals", icon: "MessageSquare" },
    { id: "meals", label: "Meals", icon: "UtensilsCrossed" },
    { id: "spaces", label: "Household Spaces", icon: "Users" },
    { id: "miniapps", label: "Mini Apps", icon: "LayoutGrid" },
  ] },
  { label: "Knowledge & Files", items: [
    { id: "files", label: "Files & Knowledge", icon: "FolderOpen" },
    { id: "activity", label: "Activity & Memory", icon: "Activity" },
  ] },
  { label: "Connections & Settings", items: [
    { id: "connections", label: "Connections", icon: "Plug" },
    { id: "settings", label: "Settings", icon: "Settings" },
  ] },
];
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
const MOBILE_PRIMARY: ScreenId[] = ["dashboard", "agents", "automations", "messages"];

function useBadges() {
  const data = useStore((s) => s.data);
  return {
    approvals: data.approvals.filter((a) => a.status === "Pending").length,
    messages: data.threads.filter((t) => t.unread).length,
  };
}

function NavList({ onNavigate, grouped = true }: { onNavigate?: () => void; grouped?: boolean }) {
  const route = useStore((s) => s.route);
  const navigate = useStore((s) => s.navigate);
  const canAccess = useStore((s) => s.canAccess);
  const badges = useBadges();
  const [advanced] = useAdvancedMode();
  const visible = (it: NavItem) => canAccess(it.id) && (!it.advanced || advanced);
  const item = (it: NavItem) => {
    const active = route.screen === it.id;
    return (
      <button key={it.id} onClick={() => { navigate(it.id); onNavigate?.(); }} aria-current={active ? "page" : undefined} className={cn("nav-link w-full", active && "nav-link-active")}>
        <Icon name={it.icon} size={18} />
        <span className="flex-1 text-left">{it.label}</span>
        {it.id === "messages" && badges.approvals > 0 && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-ink-900">{badges.approvals}</span>}
        {it.id === "messages" && badges.messages > 0 && <span className="rounded-full bg-coral-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{badges.messages}</span>}
      </button>
    );
  };
  if (!grouped) return <nav className="flex flex-col gap-0.5">{NAV.filter(visible).map(item)}</nav>;
  return (
    <nav className="flex flex-col gap-4">
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter(visible);
        if (!items.length) return null;
        return (
          <div key={g.label}>
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-ink-400/80">{g.label}</p>
            <div className="flex flex-col gap-0.5">{items.map(item)}</div>
          </div>
        );
      })}
    </nav>
  );
}

function RuntimePill() {
  const online = useStore((s) => s.backendOnline);
  const connectors = useStore((s) => s.connectors);
  const navigate = useStore((s) => s.navigate);
  const live = connectors.filter((c) => c.live).length;
  return (
    <button onClick={() => navigate("connections")} className="flex w-full items-center gap-2.5 rounded-2xl border border-white/5 bg-white/[0.06] px-3 py-2.5 text-left transition-colors hover:bg-white/10">
      <span className={cn("relative h-2.5 w-2.5 shrink-0 rounded-full", online ? "bg-sage-400" : "bg-amber-400")}>
        {online && <span className="absolute inset-0 rounded-full bg-sage-400 animate-soft-pulse" />}
      </span>
      <span className="flex-1 text-xs leading-tight text-ink-300">
        <span className="block font-semibold text-white">{online ? "Runtime online" : "Runtime offline"}</span>
        {online ? `${live} connector${live === 1 ? "" : "s"} live` : "Start the backend"}
      </span>
      <Icon name="ChevronRight" size={14} className="text-ink-400" />
    </button>
  );
}

function Sidebar() {
  const member = useStore((s) => s.currentMember());
  const session = useStore((s) => s.session);
  const household = useStore((s) => s.data.household);
  const navigate = useStore((s) => s.navigate);
  const logout = useStore((s) => s.logout);
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-gradient-to-b from-ink-900 to-[#13161f] p-3 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)] lg:flex">
      <div className="flex items-center gap-2.5 px-2 py-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-400 to-ember-600 text-white shadow-ember">
          <Icon name="House" size={22} />
        </div>
        <div className="leading-tight">
          <p className="font-display text-base font-semibold text-white">{brand.name}</p>
          <p className="text-[11px] text-ink-400">{household.name}</p>
        </div>
      </div>
      <div className="mt-3 flex-1 overflow-y-auto pr-1">
        <NavList />
      </div>
      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
        <RuntimePill />
        <div className="flex items-center gap-1">
          <button onClick={() => navigate("spaces", { tab: "members" })} className="flex flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-white/10">
            <Avatar initials={member.initials} color={member.avatarColor} size={32} />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-white">{session?.actorName ?? member.displayName}</p>
              <p className="text-[11px] text-ink-400">{session?.role ?? member.role}</p>
            </div>
          </button>
          <button onClick={() => logout()} aria-label="Sign out / switch profile" title="Sign out / switch profile" className="rounded-lg p-2 text-ink-300 hover:bg-white/10 hover:text-white"><Icon name="LogOut" size={18} /></button>
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const spaceFilter = useStore((s) => s.spaceFilter);
  const setSpaceFilter = useStore((s) => s.setSpaceFilter);
  const spaces = useStore((s) => s.data.spaces);
  const approvals = useStore((s) => s.data.approvals.filter((a) => a.status === "Pending").length);
  const navigate = useStore((s) => s.navigate);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-ink-900/[0.06] bg-surface-base/80 px-3 py-2.5 backdrop-blur-xl sm:px-5">
        <button className="rounded-xl p-2 text-ink-600 hover:bg-ink-900/[0.05] lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Icon name="Menu" size={20} />
        </button>
        <button onClick={() => setCommandOpen(true)} aria-label="Open command palette and search" className="flex flex-1 items-center gap-2 rounded-2xl border border-ink-900/10 bg-surface-rim px-3.5 py-2.5 text-sm text-ink-500 shadow-well transition-colors hover:border-ember-300 sm:max-w-md">
          <Icon name="Sparkles" size={16} className="text-ember-500" />
          <span className="flex-1 text-left">Ask FamiliOS, search, or run a command…</span>
          <kbd className="hidden rounded-md border border-ink-900/10 bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-400 sm:block">⌘K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <CalmToggle />
          {approvals > 0 && (
            <button onClick={() => navigate("messages", { tab: "approvals" })} className="hidden items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] hover:bg-amber-100 sm:flex">
              <Icon name="ShieldAlert" size={15} /> {approvals} to approve
            </button>
          )}
          <div className="relative hidden items-center sm:flex">
            <Icon name="Filter" size={14} className="pointer-events-none absolute left-2.5 text-ink-400" />
            <select value={spaceFilter} onChange={(e) => setSpaceFilter(e.target.value)} className="appearance-none rounded-xl border border-ink-900/10 bg-surface-rim py-2 pl-7 pr-7 text-sm text-ink-700 shadow-well focus:border-ember-300 focus:outline-none" title="Filter by household space">
              <option value="all">All spaces</option>
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Icon name="ChevronDown" size={14} className="pointer-events-none absolute right-2.5 text-ink-400" />
          </div>
        </div>
      </header>

      {drawer && (
        <div className="fixed inset-0 z-50 flex bg-ink-900/40 backdrop-blur-sm animate-fade-in lg:hidden" onMouseDown={() => setDrawer(false)} role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="flex h-full w-72 max-w-[82%] flex-col bg-gradient-to-b from-ink-900 to-[#13161f] p-3 animate-slide-in-right" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 py-3">
              <span className="font-display text-base font-semibold text-white">{brand.name}</span>
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded p-1 text-ink-300 hover:bg-white/10"><Icon name="X" size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto"><NavList onNavigate={() => setDrawer(false)} /></div>
            <div className="border-t border-white/10 pt-3"><RuntimePill /></div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileBottomNav() {
  const route = useStore((s) => s.route);
  const navigate = useStore((s) => s.navigate);
  const canAccess = useStore((s) => s.canAccess);
  const badges = useBadges();
  const primary = [...MOBILE_PRIMARY.filter((id) => canAccess(id)), ...NAV.map((n) => n.id).filter((id) => canAccess(id) && !MOBILE_PRIMARY.includes(id))].slice(0, 4);
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-ink-900/[0.06] bg-surface-base/90 px-1 py-1.5 shadow-[0_-1px_0_rgba(255,255,255,0.5)] backdrop-blur-xl lg:hidden">
      {primary.map((id) => {
        const it = NAV.find((n) => n.id === id)!;
        const active = route.screen === id;
        return (
          <button key={id} onClick={() => navigate(id)} className={cn("relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium transition-colors", active ? "text-ink-900" : "text-ink-400")}>
            {active && <span className="absolute -top-1.5 h-0.5 w-8 rounded-full bg-ember-400" />}
            <Icon name={it.icon} size={20} />
            {id === "messages" && (badges.messages > 0 || badges.approvals > 0) && <span className="absolute right-4 top-0.5 h-2 w-2 rounded-full bg-coral-500" />}
            {it.label.split(" ")[0]}
          </button>
        );
      })}
      <button onClick={() => navigate("assistant")} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium text-ember-600">
        <Icon name="Sparkles" size={20} /> Ask
      </button>
    </nav>
  );
}

export function StorageBanner() {
  const err = useStore((s) => s.storageError);
  if (!err) return null;
  return (
    <div className="flex items-center gap-2 bg-coral-500 px-4 py-2 text-sm font-medium text-white">
      <Icon name="TriangleAlert" size={16} /> {err}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <StorageBanner />
        <Topbar />
        <main className="flex-1 overflow-y-auto px-3 pb-24 pt-5 sm:px-5 lg:px-8 lg:pb-10">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
