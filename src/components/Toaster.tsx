import { useEffect } from "react";
import { useStore, type Toast } from "@/store/useStore";
import { Icon } from "./Icon";
import { cn } from "@/lib/cn";

const KIND: Record<Toast["kind"], { icon: string; ring: string; iconColor: string }> = {
  success: { icon: "CheckCircle2", ring: "border-sage-400", iconColor: "text-sage-500" },
  info: { icon: "Info", ring: "border-sky-400", iconColor: "text-sky-500" },
  warn: { icon: "TriangleAlert", ring: "border-amber-400", iconColor: "text-amber-500" },
  error: { icon: "OctagonAlert", ring: "border-coral-400", iconColor: "text-coral-500" },
};

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4200);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);
  const k = KIND[toast.kind];
  return (
    <div className={cn("card flex w-80 items-start gap-3 border-l-4 px-4 py-3 shadow-pop animate-slide-up", k.ring)}>
      <Icon name={k.icon} size={18} className={cn("mt-0.5 shrink-0", k.iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-800">{toast.title}</p>
        {toast.message && <p className="mt-0.5 text-xs text-ink-500">{toast.message}</p>}
      </div>
      <button onClick={() => dismiss(toast.id)} className="text-ink-400 hover:text-ink-700">
        <Icon name="X" size={15} />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastRow toast={t} />
        </div>
      ))}
    </div>
  );
}
