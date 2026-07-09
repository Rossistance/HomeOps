/**
 * Lightweight markdown renderer for FamiliOS assistant messages.
 * Handles the subset the assistant actually produces: bold, italic, inline code,
 * code blocks, headings (##/###), unordered lists (- /*), ordered lists, and
 * paragraph breaks. No external dependencies.
 */
import { type ReactNode } from "react";

type Token =
  | { t: "heading"; level: 2 | 3; text: string }
  | { t: "bullet"; text: string }
  | { t: "ordered"; n: number; text: string }
  | { t: "code_block"; lang: string; code: string }
  | { t: "blank" }
  | { t: "text"; text: string };

function tokenize(src: string): Token[] {
  const lines = src.split("\n");
  const tokens: Token[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code block
    const fence = line.match(/^```(\w*)$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      tokens.push({ t: "code_block", lang, code: codeLines.join("\n") });
      i++;
      continue;
    }
    const h2 = line.match(/^#{2,3}\s+(.*)/);
    if (h2) { tokens.push({ t: "heading", level: line.startsWith("###") ? 3 : 2, text: h2[1] }); i++; continue; }
    const ul = line.match(/^[-*]\s+(.*)/);
    if (ul) { tokens.push({ t: "bullet", text: ul[1] }); i++; continue; }
    const ol = line.match(/^(\d+)\.\s+(.*)/);
    if (ol) { tokens.push({ t: "ordered", n: Number(ol[1]), text: ol[2] }); i++; continue; }
    if (!line.trim()) { tokens.push({ t: "blank" }); i++; continue; }
    tokens.push({ t: "text", text: line }); i++;
  }
  return tokens;
}

/** Render inline markdown: **bold**, *italic*, `code`. */
function InlineContent({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  // Split by bold (**text**), italic (*text*), inline code (`text`)
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const raw = m[0];
    if (raw.startsWith("**")) parts.push(<strong key={key++}>{raw.slice(2, -2)}</strong>);
    else if (raw.startsWith("`")) parts.push(<code key={key++} className="rounded bg-ink-900/[0.06] px-1 py-0.5 font-mono text-[0.8em]">{raw.slice(1, -1)}</code>);
    else parts.push(<em key={key++}>{raw.slice(1, -1)}</em>);
    last = m.index + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function MarkdownContent({ text, className = "" }: { text: string; className?: string }) {
  const tokens = tokenize(text ?? "");
  const nodes: ReactNode[] = [];
  let ulBuf: string[] = [];
  let olBuf: { n: number; text: string }[] = [];
  let pBuf: string[] = [];
  let key = 0;

  const flushUl = () => {
    if (!ulBuf.length) return;
    nodes.push(
      <ul key={key++} className="my-1.5 ml-4 list-disc space-y-0.5 text-sm text-ink-700">
        {ulBuf.map((t, i) => <li key={i}><InlineContent text={t} /></li>)}
      </ul>
    );
    ulBuf = [];
  };
  const flushOl = () => {
    if (!olBuf.length) return;
    nodes.push(
      <ol key={key++} className="my-1.5 ml-4 list-decimal space-y-0.5 text-sm text-ink-700">
        {olBuf.map((item, i) => <li key={i}><InlineContent text={item.text} /></li>)}
      </ol>
    );
    olBuf = [];
  };
  const flushP = () => {
    if (!pBuf.length) return;
    const joined = pBuf.join(" ");
    nodes.push(<p key={key++} className="text-sm leading-relaxed text-ink-800"><InlineContent text={joined} /></p>);
    pBuf = [];
  };

  for (const tok of tokens) {
    if (tok.t === "bullet") { flushP(); flushOl(); ulBuf.push(tok.text); continue; }
    if (tok.t === "ordered") { flushP(); flushUl(); olBuf.push(tok); continue; }
    flushUl(); flushOl();
    if (tok.t === "blank") { flushP(); continue; }
    if (tok.t === "heading") {
      flushP();
      const cls = tok.level === 2 ? "mt-3 mb-1 text-sm font-semibold text-ink-900" : "mt-2 mb-0.5 text-sm font-medium text-ink-800";
      nodes.push(tok.level === 2 ? <h2 key={key++} className={cls}><InlineContent text={tok.text} /></h2> : <h3 key={key++} className={cls}><InlineContent text={tok.text} /></h3>);
      continue;
    }
    if (tok.t === "code_block") {
      flushP();
      nodes.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded-xl border border-ink-900/[0.06] bg-surface-sunken px-3 py-2.5 font-mono text-xs text-ink-700">
          <code>{tok.code}</code>
        </pre>
      );
      continue;
    }
    pBuf.push(tok.text);
  }
  flushUl(); flushOl(); flushP();

  return <div className={`space-y-1 ${className}`}>{nodes}</div>;
}
