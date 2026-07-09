// Shared cosmetic mapping for agents: an SF Symbol + tint by name keyword, and
// a human schedule line derived from the agent's triggers.
import type { TriggerRec } from "@/lib/api";
import type { HearthColors } from "@/theme";

export function agentIcon(name: string): string {
  const n = name.toLowerCase();
  if (/brief|morning|digest/.test(n)) return "sun.max";
  if (/school|daycare|homework/.test(n)) return "graduationcap";
  if (/bill|receipt|budget|spend/.test(n)) return "tag";
  if (/meal|grocer|dinner|recipe/.test(n)) return "fork.knife";
  if (/home|mainten|repair|yard|plant/.test(n)) return "wrench.adjustable";
  if (/care|health|med/.test(n)) return "heart";
  if (/pet|dog|cat/.test(n)) return "pawprint";
  if (/gift|birthday|party/.test(n)) return "gift";
  if (/doc|file|organiz/.test(n)) return "folder";
  if (/carpool|ride|drive/.test(n)) return "person.2";
  if (/travel|trip|pack/.test(n)) return "airplane";
  return "cpu";
}

export function agentTint(c: HearthColors, status: string): { fg: string; bg: string } {
  switch (status) {
    case "Active": return { fg: c.sage, bg: c.sageBg };
    case "Paused": return { fg: c.textMuted, bg: c.surfaceSunken };
    case "Needs Attention": return { fg: c.amber, bg: c.amberBg };
    case "Draft": return { fg: c.sky, bg: c.skyBg };
    default: return { fg: c.textMuted, bg: c.surfaceSunken };
  }
}

export function humanSchedule(t: TriggerRec): string {
  if (t.runAt) {
    const d = new Date(t.runAt);
    if (!Number.isNaN(d.getTime())) {
      return `Once, ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    }
    return `At ${t.runAt}`;
  }
  if (t.intervalMs) {
    const h = t.intervalMs / 3600000;
    if (h >= 24 * 6.5 && h <= 24 * 7.5) return "Weekly";
    if (h >= 23 && h <= 25) return "Every day";
    if (h >= 1) return `Every ${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
    return `Every ${Math.round(t.intervalMs / 60000)} min`;
  }
  if (t.type === "webhook") return "When an event arrives";
  if (t.type === "connector_event") return "When something new arrives";
  return "Runs manually";
}

export function scheduleForAgent(agentId: string, triggers: TriggerRec[]): string | null {
  const mine = triggers.filter((t) => t.agentId === agentId && t.enabled !== false);
  if (mine.length === 0) return null;
  return humanSchedule(mine[0]);
}
