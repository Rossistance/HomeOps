// Library space categorization — pure logic, no React Native imports, so it is
// unit-testable under node (WP-002/ISS-002: honest categorization).
//
// Filing precedence (T-202): an EXPLICIT space tag (written by the upload sheet)
// always wins; only untagged files fall back to name/tag keyword heuristics.
// The medical heuristic uses word boundaries so "video.mp4" or "Friday.pdf"
// never land in Medical & IDs by accident.
import type { FileRec } from "@/lib/api";

export const SPACE_DEFS = [
  { key: "school", label: "School", icon: "graduationcap", tint: "sky", match: /school|class|teacher|homework|permission/i },
  { key: "medical", label: "Medical & IDs", icon: "heart", tint: "lavender", sensitive: true, match: /medic|health|passport|\bids?\b|insurance-card|sensitive/i },
  { key: "bills", label: "Bills & Receipts", icon: "tag", tint: "amber", match: /bill|receipt|invoice|utility|statement/i },
  { key: "home", label: "Home", icon: "wrench.adjustable", tint: "sage", match: /./ },
] as const;
export type SpaceKey = (typeof SPACE_DEFS)[number]["key"];

// Explicit tags the upload sheet writes (spaceTag() of the picker labels).
const EXPLICIT_TAG: Record<string, SpaceKey> = {
  school: "school",
  "medical-ids": "medical",
  "bills-receipts": "bills",
  home: "home",
};

/** Minimal shape needed to categorize — lets tests pass plain objects. */
export type SpaceOfInput = Pick<FileRec, "spaceId" | "tags" | "name">;

export function spaceOf(f: SpaceOfInput): SpaceKey {
  // 1) Explicit filing wins — the category the uploader chose.
  for (const t of f.tags) {
    const explicit = EXPLICIT_TAG[t.toLowerCase()];
    if (explicit) return explicit;
  }
  // 2) Heuristic fallback for legacy/untagged files.
  const hay = `${f.spaceId} ${f.tags.join(" ")} ${f.name}`;
  for (const s of SPACE_DEFS) if (s.match.test(hay)) return s.key;
  return "home";
}

export function spaceLabelOf(k: SpaceKey): string {
  return SPACE_DEFS.find((s) => s.key === k)?.label ?? "Home";
}

/** The explicit tag that files a record into the given space. */
export function explicitTagOf(k: SpaceKey): string {
  return Object.entries(EXPLICIT_TAG).find(([, v]) => v === k)?.[0] ?? "home";
}

/** "Let Famili decide" (WP-002): decide from the file name via the same
 * word-boundary heuristics, then file EXPLICITLY so the result is stable and
 * disclosed — never a silent untagged fallback. */
export function decideSpace(name: string): SpaceKey {
  return spaceOf({ spaceId: "", tags: [], name });
}
