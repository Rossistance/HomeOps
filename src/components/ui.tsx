import { useEffect, useRef, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import type { RiskLevel, AccentColor } from "@/types";

/**
 * Focus management for overlays: moves focus into the dialog, traps Tab within it,
 * and restores focus to the previously-focused element on close. (A11y P2-A11Y-002)
 */
function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers almost always pass an inline `onClose` (a fresh function identity every
  // render). Keep it in a ref so this effect depends ONLY on `open` — otherwise, any
  // state update in the component that owns the dialog (e.g. an input's value living
  // in the parent, not the dialog) re-runs this effect on every keystroke, which calls
  // `first?.focus()` again and steals focus back to the dialog's first focusable
  // element (typically its "close" button, rendered before the body) — the exact
  // "type one character, then have to click back in" bug.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const sel = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
    const first = node?.querySelector<HTMLElement>(sel);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(sel)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); opener?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose intentionally excluded; see onCloseRef above
  }, [open]);
  return ref;
}

/* ------------------------------- Accents -------------------------------- */

export const ACCENT_BG: Record<string, string> = {
  ink: "bg-ink-100 text-ink-700",
  sage: "bg-sage-100 text-sage-600",
  coral: "bg-coral-100 text-coral-600",
  amber: "bg-amber-100 text-amber-600",
  sky: "bg-sky-100 text-sky-600",
  lavender: "bg-lavender-100 text-lavender-600",
  gray: "bg-sand-200 text-ink-600",
};

export const ACCENT_SOLID: Record<string, string> = {
  ink: "bg-ink-700",
  sage: "bg-sage-500",
  coral: "bg-coral-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  lavender: "bg-lavender-500",
  gray: "bg-ink-400",
};

/* ------------------------------- Button --------------------------------- */

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "ember";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: {
  variant?: BtnVariant;
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v =
    variant === "primary" ? "btn-primary" : variant === "ember" ? "btn-ember" : variant === "danger" ? "btn-danger" : variant === "success" ? "btn-success" : variant === "ghost" ? "btn-ghost" : "btn-secondary";
  return (
    <button className={cn(v, size === "sm" && "btn-sm", className)} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className,
  active,
  ...rest
}: { icon: string; label: string; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-sand-100 hover:text-ink-800",
        active && "bg-sand-100 text-ink-800",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/* -------------------------------- Card ---------------------------------- */

export function Card({
  className,
  children,
  onClick,
  hover,
  ariaLabel,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  hover?: boolean;
  ariaLabel?: string;
}) {
  // Clickable cards must be keyboard-operable (P2-A11Y-001): focusable, Enter/Space
  // activate, and a visible focus ring.
  const interactive = !!onClick;
  return (
    <div
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? ariaLabel : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      className={cn("card", (hover || interactive) && "lift pressable cursor-pointer", interactive && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base", className)}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="section-title flex items-center gap-2">
        {icon && <Icon name={icon} size={14} />}
        {children}
      </h3>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-center gap-3.5">
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_16px_rgba(23,27,38,0.22)]">
            <Icon name={icon} size={23} />
          </div>
        )}
        <div>
          <h1 className="font-display text-[1.8rem] font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------- Badges --------------------------------- */

// Badge text uses the darker -700 tints for WCAG AA contrast on the -100 fills
// (P3-VIS-001), kept separate from the icon-chip ACCENT_BG map.
const BADGE_BG: Record<string, string> = {
  ink: "bg-ink-100 text-ink-700",
  sage: "bg-sage-100 text-sage-700",
  coral: "bg-coral-100 text-coral-700",
  amber: "bg-amber-100 text-amber-700",
  sky: "bg-sky-100 text-sky-700",
  lavender: "bg-lavender-100 text-lavender-700",
  gray: "bg-sand-200 text-ink-700",
};

export function Badge({
  children,
  color = "gray",
  className,
}: {
  children: ReactNode;
  color?: AccentColor | "gray";
  className?: string;
}) {
  return <span className={cn("chip", BADGE_BG[color] ?? BADGE_BG.gray, className)}>{children}</span>;
}

const RISK_COLOR: Record<RiskLevel, AccentColor | "gray"> = {
  Low: "sage",
  Medium: "amber",
  High: "coral",
  Sensitive: "lavender",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge color={RISK_COLOR[level]}>
      <Icon name={level === "Low" ? "ShieldCheck" : level === "Sensitive" ? "Lock" : "ShieldAlert"} size={12} />
      {level} risk
    </Badge>
  );
}

export function StatusDot({ color = "gray", label, pulse }: { color?: string; label?: ReactNode; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600">
      <span className={cn("h-2 w-2 rounded-full", ACCENT_SOLID[color] ?? ACCENT_SOLID.gray, pulse && "animate-soft-pulse")} />
      {label}
    </span>
  );
}

export function Avatar({ initials, color = "ink", size = 36 }: { initials: string; color?: string; size?: number }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", ACCENT_BG[color] ?? ACCENT_BG.gray)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-lg bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-600">{children}</span>;
}

/** Stacked, per-person colored dots — the "who is this for" cue used on calendar items.
 *  Each person's `color` is an accent-palette key (their member color / avatarColor). */
export function MemberDots({ members, max = 5 }: { members: { id?: string; name?: string; color: string }[]; max?: number }) {
  if (!members.length) return null;
  return (
    <span className="flex shrink-0 -space-x-1" title={members.map((m) => m.name).filter(Boolean).join(", ")}>
      {members.slice(0, max).map((m, i) => (
        <span key={m.id ?? i} className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-surface-raised", ACCENT_SOLID[m.color] ?? ACCENT_SOLID.gray)} />
      ))}
    </span>
  );
}

/* ------------------------------- Modal ---------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  icon?: string;
}) {
  const ref = useDialogFocus(open, onClose);
  const titleId = useId();
  if (!open) return null;
  const w = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-2xl" : size === "xl" ? "max-w-4xl" : "max-w-lg";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/50 p-4 backdrop-blur-md animate-fade-in sm:p-8" onMouseDown={onClose}>
      <div
        ref={ref}
        className={cn("card-pad card my-auto w-full animate-scale-in shadow-e3", w)}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Dialog"}
      >
        {title && (
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-display flex items-center gap-2 text-xl font-semibold text-ink-900">
              {icon && <Icon name={icon} size={20} />}
              {title}
            </h2>
            <IconButton icon="X" label="Close dialog" onClick={onClose} />
          </div>
        )}
        <div>{children}</div>
        {footer && <div className="mt-6 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------- Drawer --------------------------------- */

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = "max-w-xl",
  icon,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: string;
  icon?: string;
  footer?: ReactNode;
}) {
  const ref = useDialogFocus(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/50 backdrop-blur-md animate-fade-in" onMouseDown={onClose}>
      <div
        ref={ref}
        className={cn("flex h-full w-full flex-col border-l border-ink-900/10 bg-surface-base shadow-e3 animate-slide-in-right", width)}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between border-b border-ink-900/[0.06] bg-surface-raised px-5 py-4 shadow-[0_1px_0_rgba(255,255,255,0.6)]">
          <h2 id={titleId} className="font-display flex items-center gap-2 text-xl font-semibold text-ink-900">
            {icon && <Icon name={icon} size={20} />}
            {title}
          </h2>
          <IconButton icon="X" label="Close panel" onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-900/[0.06] bg-surface-raised px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* -------------------------------- Tabs ---------------------------------- */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number; icon?: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-900/[0.08]">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
            active === t.id ? "border-ember-400 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-700",
          )}
        >
          {t.icon && <Icon name={t.icon} size={15} />}
          {t.label}
          {t.count !== undefined && (
            <span className={cn("rounded-full px-1.5 py-0.5 text-xs", active === t.id ? "bg-ember-600 text-white" : "bg-surface-sunken text-ink-600")}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Inputs --------------------------------- */

export function Field({ label, children, hint, className }: { label?: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input", props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("input min-h-[88px] resize-y", props.className)} />;
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn("input appearance-none bg-white pr-8", props.className)}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: string; ariaLabel?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? ariaLabel ?? "Toggle setting"}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2"
    >
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-sage-500" : "bg-sand-300")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </span>
      {label && <span className="text-sm text-ink-700">{label}</span>}
    </button>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
      <span
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={cn("flex h-4.5 w-4.5 items-center justify-center rounded border", checked ? "border-ink-800 bg-ink-800 text-white" : "border-sand-300 bg-white")}
        style={{ width: 18, height: 18 }}
      >
        {checked && <Icon name="Check" size={13} />}
      </span>
      {label}
    </label>
  );
}

/* ----------------------------- Empty state ------------------------------ */

export function EmptyState({
  icon = "Inbox",
  title,
  message,
  action,
}: {
  icon?: string;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-ink-900/15 bg-surface-sunken/60 px-6 py-12 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-raised text-ink-500 shadow-e1">
        <Icon name={icon} size={24} />
      </div>
      <p className="font-display text-lg font-semibold text-ink-800">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-ink-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, color = "sage" }: { value: number; color?: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken shadow-well">
      <div className={cn("h-full rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-all", ACCENT_SOLID[color] ?? ACCENT_SOLID.sage)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* --------------------------- Connector readiness ------------------------ */

const READINESS_UI: Record<string, { label: string; color: AccentColor | "gray"; icon: string; live: boolean }> = {
  connected: { label: "Connected", color: "sage", icon: "CircleCheck", live: true },
  authorized_write: { label: "Authorized · Write", color: "sage", icon: "CircleCheck", live: true },
  authorized_readonly: { label: "Authorized · Read-only", color: "sky", icon: "Eye", live: true },
  local_only: { label: "Local-only", color: "sky", icon: "HardDrive", live: true },
  needs_auth: { label: "Needs authorization", color: "amber", icon: "KeyRound", live: false },
  not_configured: { label: "Setup required", color: "amber", icon: "Settings2", live: false },
  not_installed: { label: "Not installed", color: "gray", icon: "Circle", live: false },
  runtime_unavailable: { label: "Runtime not connected", color: "amber", icon: "PlugZap", live: false },
  degraded: { label: "Degraded", color: "amber", icon: "TriangleAlert", live: false },
  error: { label: "Error", color: "coral", icon: "OctagonAlert", live: false },
  revoked: { label: "Revoked", color: "coral", icon: "Ban", live: false },
};

export function ReadinessBadge({ readiness, className }: { readiness: string; className?: string }) {
  const m = READINESS_UI[readiness] ?? READINESS_UI.not_configured;
  return (
    <span className={cn("chip", ACCENT_BG[m.color] ?? ACCENT_BG.gray, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", ACCENT_SOLID[m.color] ?? ACCENT_SOLID.gray, m.live && "animate-soft-pulse")} />
      {m.label}
    </span>
  );
}

/* --------------------------- Premium primitives ------------------------- */

export function StatTile({ icon, label, value, accent = "ink", onClick }: { icon: string; label: string; value: ReactNode; accent?: AccentColor | "gray"; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={cn("card flex flex-col gap-2 px-4 py-3.5 text-left", onClick && "lift pressable")}>
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]", ACCENT_BG[accent] ?? ACCENT_BG.gray)}><Icon name={icon} size={17} /></span>
      <span className="font-display text-3xl font-semibold leading-none text-ink-900">{value}</span>
      <span className="text-xs font-medium text-ink-500">{label}</span>
    </button>
  );
}

export function HealthDot({ ok, label }: { ok: boolean; label?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600">
      <span className={cn("h-2 w-2 rounded-full", ok ? "bg-sage-500" : "bg-amber-500", ok && "animate-soft-pulse")} />
      {label}
    </span>
  );
}
