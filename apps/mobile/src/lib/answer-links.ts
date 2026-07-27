// Pulling the links out of an answer.
//
// Split from the component (components/LinkCards) so it can be tested: that file imports React
// Native, which a node test can't load, and this is the half that runs over model output — the
// least predictable text in the app. A missed link is a card that never appears; a badly parsed
// one is a card that goes nowhere.

export interface AnswerLink { title: string; url: string }

/** Pull `[title](url)` and bare URLs out of an answer, in the order they appear. */
export function linksIn(text: string): AnswerLink[] {
  const out: AnswerLink[] = [];
  const seen = new Set<string>();
  const push = (title: string, url: string) => {
    const clean = url.replace(/[.,;)]+$/, "");
    if (seen.has(clean)) return;
    seen.add(clean);
    out.push({ title: title.trim() || hostOf(clean), url: clean });
  };
  const md = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m: RegExpExecArray | null;
  const withoutMd = String(text ?? "").replace(md, (_all, t: string, u: string) => { push(t, u); return " "; });
  const bare = /https?:\/\/[^\s)<>"']+/g;
  while ((m = bare.exec(withoutMd)) !== null) push(hostOf(m[0]), m[0]);
  return out;
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
