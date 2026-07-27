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

/**
 * "Let Famili decide" (WP-002): file explicitly, so the result is stable and disclosed rather
 * than a silent untagged fallback.
 *
 * P3 — "I uploaded a receipt from Home Depot for a Ryobi drill as a PDF. I let Famili decide,
 * and Famili decided to put it into Home — which would make sense if it were NOT a receipt. So
 * this is wrong. It should have gone into Bills & Receipts."
 *
 * It decided from the FILENAME alone. A camera-roll PDF is called something like
 * `IMG_3011.pdf`, which matches nothing, so it fell through to Home — and Home's pattern is
 * `/./`, which matches everything. Worse: a receipt from HOME Depot has the word "home" in its
 * text, so even reading the contents naively would land it right back where it started.
 *
 * So `text` is now accepted and weighted properly: a document is scored against each space's
 * keywords, the specific spaces (School, Medical, Bills) are checked before the catch-all, and
 * Home only wins when nothing else does. The caller passes whatever it has — the server can
 * read the file, and passes its text; a client with only a name still works exactly as before.
 */
export function decideSpace(name: string, text?: string): SpaceKey {
  const body = String(text ?? "").slice(0, 4000);
  if (body.trim()) {
    /* Score, don't first-match. "Home Depot receipt" contains both "home" and "receipt"; the
     * one that appears as a real signal more often should win, and a receipt is a receipt
     * wherever it was bought. Home is excluded from scoring entirely — its pattern matches
     * anything, so it can only ever be the fallback, never a winner. */
    const scored = SPACE_DEFS
      .filter((d) => d.key !== "home")
      .map((d) => ({ key: d.key, hits: (body.match(new RegExp(d.match.source, "gi")) ?? []).length }))
      .sort((a, b) => b.hits - a.hits);
    if (scored[0] && scored[0].hits > 0) return scored[0].key;
  }
  return spaceOf({ spaceId: "", tags: [], name });
}
