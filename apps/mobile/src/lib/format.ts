// Human-readable projections of raw run data. Step outputs sometimes carry
// structured JSON (tool results) — never show that to a person.
export function humanDetail(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.startsWith("{") || s.startsWith("[")) {
    // Pull the few human-meaningful fields out of a structured result.
    try {
      const j = JSON.parse(s);
      const obj = Array.isArray(j) ? j[0] ?? {} : j;
      const parts: string[] = [];
      if (typeof obj.title === "string") parts.push(obj.title);
      if (typeof obj.name === "string" && !parts.length) parts.push(obj.name);
      if (Number.isFinite(obj.groceryItems)) parts.push(`${obj.groceryItems} grocery item${obj.groceryItems === 1 ? "" : "s"}`);
      if (Number.isFinite(obj.count)) parts.push(`${obj.count} items`);
      if (obj.eventId) parts.push("added to calendar");
      return parts.length ? parts.join(" · ") : "Done — structured result saved";
    } catch {
      return "Done — structured result saved";
    }
  }
  return s;
}
