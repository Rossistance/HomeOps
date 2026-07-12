import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ACCENT_BG } from "@/components/ui";
import { backend } from "@/connectors/api";

/** Accent-key → real hex (Hearth token values from tailwind.config.js). Used wherever a
 *  member's color must feed real CSS (avatar rings, calendar gradients, event bars). */
export const ACCENT_HEX: Record<string, string> = {
  ink: "#2a3147",
  sage: "#4e8c5e",
  coral: "#d25839",
  amber: "#c78d2f",
  sky: "#4b85b9",
  lavender: "#9578bf",
  ember: "#ce5d1d",
  gray: "#9aa1b0",
};

// Fetched avatar photos, keyed by server file id — avatars render in many places, so
// each photo is downloaded once per session.
const photoCache = new Map<string, string>();

/** The one member avatar: renders an `emoji:🦊` curated avatar, an uploaded photo
 *  (fetched as a data URI from the durable file store), or initials — always wrapped
 *  in a 2px ring in the member's accent color. */
export function MemberAvatar({ initials, color = "ink", photoFileId, size = 36, ring = true }: {
  initials: string;
  color?: string;
  photoFileId?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const emoji = photoFileId?.startsWith("emoji:") ? photoFileId.slice("emoji:".length) : null;
  const fileId = photoFileId && !emoji ? photoFileId : null;
  const [src, setSrc] = useState<string | null>(fileId ? photoCache.get(fileId) ?? null : null);

  useEffect(() => {
    if (!fileId) { setSrc(null); return; }
    const cached = photoCache.get(fileId);
    if (cached) { setSrc(cached); return; }
    let alive = true;
    void backend.fileContent(fileId).then((r) => {
      if (!alive || !r.contentBase64) return;
      const uri = `data:${r.mime ?? "image/jpeg"};base64,${r.contentBase64}`;
      photoCache.set(fileId, uri);
      setSrc(uri);
    });
    return () => { alive = false; };
  }, [fileId]);

  const inner = size - (ring ? 4 : 0); // 2px ring + hairline gap
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, ...(ring ? { border: `2px solid ${ACCENT_HEX[color] ?? ACCENT_HEX.gray}` } : {}) }}
    >
      {src ? (
        <img src={src} alt="" className="rounded-full object-cover" style={{ width: inner, height: inner }} />
      ) : emoji ? (
        <span className="flex items-center justify-center rounded-full bg-surface-sunken" style={{ width: inner, height: inner, fontSize: inner * 0.55, lineHeight: 1 }} aria-hidden="true">{emoji}</span>
      ) : (
        <span
          className={cn("flex items-center justify-center rounded-full font-semibold", ACCENT_BG[color] ?? ACCENT_BG.gray)}
          style={{ width: inner, height: inner, fontSize: inner * 0.38 }}
        >
          {initials}
        </span>
      )}
    </span>
  );
}
