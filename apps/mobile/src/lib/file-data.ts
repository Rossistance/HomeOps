// A file's bytes as a data URI, fetched once per app session. Chat photos and voice notes
// repeat across renders and screens, and /api/files/:id/content is base64 JSON, so the
// cache is the difference between one download and one per scroll.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export async function fileDataUri(fileId: string): Promise<string | null> {
  const hit = cache.get(fileId);
  if (hit) return hit;
  const pending = inflight.get(fileId);
  if (pending) return pending;
  const p = api.fileContent(fileId).then((r) => {
    inflight.delete(fileId);
    if (!r.contentBase64) return null;
    const uri = `data:${r.mime ?? "application/octet-stream"};base64,${r.contentBase64}`;
    cache.set(fileId, uri);
    return uri;
  });
  inflight.set(fileId, p);
  return p;
}

/** Seed the cache with bytes the app already has (a photo it just uploaded). */
export function rememberFile(fileId: string, mime: string, base64: string) {
  cache.set(fileId, `data:${mime};base64,${base64}`);
}

export function useFileDataUri(fileId: string | null | undefined): string | null {
  const [uri, setUri] = useState<string | null>(fileId ? cache.get(fileId) ?? null : null);
  useEffect(() => {
    if (!fileId) { setUri(null); return; }
    let cancelled = false;
    void fileDataUri(fileId).then((u) => { if (!cancelled) setUri(u); });
    return () => { cancelled = true; };
  }, [fileId]);
  return uri;
}
