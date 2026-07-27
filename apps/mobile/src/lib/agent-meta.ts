// Shared cosmetic mapping for agents: an SF Symbol + tint by name keyword, and
// a human schedule line derived from the agent's triggers.
import type { TriggerRec } from "@/lib/api";
import type { HearthColors } from "@/theme";
import { categoryStyle } from "@/theme/categories";

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

/**
 * An agent's own colour and icon, from what it's FOR.
 *
 * "Each one of these icons that's supposed to be for a certain agent — they're not coloured per
 *  that agent, they're all just the orange… while one is Household, one is Meals, and another
 *  is a Briefing category, they actually share the same colour, and they shouldn't."
 *
 * The old pair was agentIcon(name) for the glyph and agentTint(status) for the colour, which is
 * why every Active agent was the same green and every card's tile the same ember: the colour
 * was answering "is it running", not "what is it". Status still has a home — the badge — but
 * identity belongs to the icon.
 *
 * Reads name, purpose and category together, because an agent called "Morning Briefing" and one
 * categorised "Briefing" are the same thing to a person and were two different colours here.
 */
export function agentLook(c: HearthColors, a: { name?: string; purpose?: string; category?: string | null }) {
  return categoryStyle(c, `${a.category ?? ""} ${a.name ?? ""} ${a.purpose ?? ""}`.trim());
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

/**
 * Which real-world CONNECTIONS a helper touches, derived from its tool ids.
 *
 * From the 2026-07-25 walkthrough: "I also have no idea what tools it uses, what
 * connections it uses — that should be easily and visibly displayed there on that card.
 * It doesn't have to be big, but so there's a visual reference." A raw id like
 * `gmail.search` is not that reference; "Gmail" is.
 *
 * Internal `homeops.*` tools are deliberately omitted — they are FamiliOS itself, not an
 * outside account the family has to connect or can lose.
 */
const CONNECTION_LABELS: Record<string, { label: string; icon: string }> = {
  gmail: { label: "Gmail", icon: "envelope" },
  gcal: { label: "Google Calendar", icon: "calendar" },
  google: { label: "Google", icon: "calendar" },
  calendar: { label: "Calendar", icon: "calendar" },
  sms: { label: "Text messaging", icon: "message" },
  twilio: { label: "Text messaging", icon: "message" },
  weather: { label: "Weather", icon: "cloud.sun" },
  web: { label: "Web search", icon: "globe" },
  browser: { label: "Browser", icon: "safari" },
  rss: { label: "Feeds", icon: "dot.radiowaves.left.and.right" },
  http: { label: "External service", icon: "network" },
  smarthome: { label: "Smart home", icon: "house" },
  slack: { label: "Slack", icon: "number" },
  dropbox: { label: "Dropbox", icon: "shippingbox" },
};

export function connectionsForToolIds(toolIds?: string[] | null): { label: string; icon: string }[] {
  const seen = new Map<string, { label: string; icon: string }>();
  for (const id of toolIds ?? []) {
    const prefix = String(id).split(".")[0]?.toLowerCase();
    if (!prefix || prefix === "homeops") continue;
    const meta = CONNECTION_LABELS[prefix];
    if (meta && !seen.has(meta.label)) seen.set(meta.label, meta);
  }
  return [...seen.values()];
}
