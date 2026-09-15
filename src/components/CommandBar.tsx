import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { Icon } from "./Icon";
import { cn } from "@/lib/cn";
import type { ScreenId } from "@/types";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  kind: string;
  run: () => void;
}

export function CommandBar() {
  const open = useStore((s) => s.commandOpen);
  const setOpen = useStore((s) => s.setCommandOpen);
  const navigate = useStore((s) => s.navigate);
  const searchEverything = useStore((s) => s.searchEverything);
  const createTask = useStore((s) => s.createTask);

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const go = (screen: ScreenId, params?: Record<string, string>) => {
    navigate(screen, params);
    setOpen(false);
  };

  const quickActions: CommandItem[] = useMemo(
    () => [
      { id: "qa-helper", label: "New helper", icon: "Bot", kind: "Action", run: () => go("helpers", { new: "1" }) },
      { id: "qa-upload", label: "Upload document", icon: "Upload", kind: "Action", run: () => go("files", { new: "1" }) },
      { id: "qa-reminder", label: "Create reminder", icon: "BellPlus", kind: "Action", run: () => go("dashboard", { new: "reminder" }) },
      { id: "qa-member", label: "Add family member", icon: "UserPlus", kind: "Action", run: () => go("spaces", { tab: "members", new: "1" }) },
      { id: "qa-app", label: "Build mini app", icon: "LayoutGrid", kind: "Action", run: () => go("miniapps", { new: "1" }) },
      { id: "qa-connect", label: "Connect an account", icon: "Plug", kind: "Action", run: () => go("connections") },
      { id: "qa-update", label: "Send a family update", icon: "Send", kind: "Action", run: () => go("messages", { new: "1" }) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const nlActions: CommandItem[] = useMemo(() => {
    const q = query.trim();
    const out: CommandItem[] = [];
    let m: RegExpMatchArray | null;
    if ((m = q.match(/^create (?:an? )?(?:agent|helper)(?:\s+(?:that|to))?[:\s]+(.+)/i))) {
      const rest = m[1];
      out.push({
        id: "nl-helper",
        label: `New helper: “${rest}”`,
        hint: "Opens the helper form so you read and edit what it gets told to do",
        icon: "Bot",
        kind: "Create",
        run: () => go("helpers", { new: "1" }),
      });
    }
    if ((m = q.match(/^(?:remind me|reminder|create reminder|add reminder)[:\s]+(.+)/i))) {
      const rest = m[1];
      out.push({
        id: "nl-reminder",
        label: `Create reminder: “${rest}”`,
        icon: "BellPlus",
        kind: "Create",
        run: () => {
          createTask({ title: rest, type: "reminder", priority: "medium" });
          go("dashboard");
        },
      });
    }
    return out;
  }, [query, createTask]);

  const results: CommandItem[] = useMemo(() => {
    if (!query.trim()) return [];
    return searchEverything(query).map((r) => ({
      id: r.id,
      label: r.title,
      hint: `${r.type} · ${r.summary}`.slice(0, 80),
      icon: r.icon,
      kind: r.type,
      run: () => go(r.route.screen, r.route.params),
    }));
  }, [query, searchEverything]);

  const items: CommandItem[] = query.trim() ? [...nlActions, ...results] : quickActions;
  const visible = items.slice(0, 50);

  useEffect(() => setSel(0), [query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink-900/50 p-4 backdrop-blur-md animate-fade-in sm:pt-24" onMouseDown={() => setOpen(false)}>
      <div className="glass w-full max-w-xl animate-scale-in overflow-hidden rounded-3xl shadow-e3" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="flex items-center gap-3 border-b border-ink-900/[0.06] px-4">
          <Icon name="Search" size={18} className="text-ember-500" />
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-listbox"
            aria-activedescendant={visible[sel] ? `command-opt-${visible[sel].id}` : undefined}
            aria-label="Search everything, or type a command"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, visible.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                visible[sel]?.run();
              }
            }}
            placeholder="Search everything, or type a command…"
            className="flex-1 bg-transparent py-3.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          <kbd className="hidden rounded-md border border-ink-900/10 bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-400 sm:block">ESC</kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2" role="listbox" id="command-listbox" aria-label="Commands and results">
          {!query.trim() && <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Quick actions</p>}
          {query.trim() && nlActions.length > 0 && <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Create</p>}
          {visible.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-ink-400">
              No matches. Try “create helper that…”, “remind me to…”, or a name.
            </div>
          )}
          {query.trim() && results.length > 0 && nlActions.length > 0 && (
            <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Results</p>
          )}
          {visible.map((item, i) => (
            <button
              key={item.id}
              id={`command-opt-${item.id}`}
              role="option"
              aria-selected={sel === i}
              onMouseEnter={() => setSel(i)}
              onClick={() => item.run()}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors",
                sel === i
                  ? "bg-surface-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ring-1 ring-ink-900/[0.06]"
                  : "hover:bg-surface-overlay",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                <Icon name={item.icon} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-800">{item.label}</span>
                {item.hint && <span className="block truncate text-xs text-ink-400">{item.hint}</span>}
              </span>
              <span className="shrink-0 rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-400">{item.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
