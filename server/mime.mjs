// FamiliOS — one MIME builder for every email that leaves over a household's Gmail.
//
// Why this exists. Three call sites (notify.mjs, providers.mjs, connectors.mjs) each hand-
// rolled `To:/Subject:/Content-Type:` and base64url'd the bytes. Two things were wrong with
// that, and both showed up in a real inbox on 2026-09-17:
//   1. The Subject was raw UTF-8. Headers are 7-bit by contract (RFC 5322) — Gmail reads the
//      bytes as Latin-1 and "FamiliOS · Week Ahead — Next seven days" arrives as
//      "FamiliOS Ã‚Â· Week Ahead Ã¢Â€Â" Next seven days". Every helper deliverable has that
//      middle dot and dash. RFC 2047 encoded-words fix it.
//   2. The body was 8-bit with no Content-Transfer-Encoding. Most of it survives (Gmail is
//      lenient), but emoji and other astral characters are not guaranteed to — the family
//      calendar has "🇸🇻" in an event title, and it was gone in the delivered email.
//      base64 parts are boring and always survive.
// Also: the plain-text deliverables are readable but flat. A helper writes headings and
// "- " bullets for a person, so the email now carries a multipart/alternative with a small
// HTML rendering of exactly that text (headings bold, bullets as lists). Nothing is invented;
// the text part is what the helper wrote and the HTML is a faithful shape of it.
//
// Dependency-free on purpose (like mailer.mjs): no nodemailer, no template engine.

const ASCII = /^[\x20-\x7e]*$/;

/**
 * RFC 2047 "B" encoding for a header value, split into ≤75-char encoded-words on character
 * boundaries (never inside a multibyte sequence). ASCII-only values pass through untouched
 * so the common case stays readable in raw form.
 */
export function encodeHeaderValue(value) {
  const s = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  if (ASCII.test(s)) return s;
  const words = [];
  let chunk = "";
  for (const ch of s) {
    // 45 raw bytes → 60 base64 chars → 72-char encoded-word (limit is 75).
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) { words.push(chunk); chunk = ""; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

/** Fold a base64 payload into 76-column lines as MIME wants. */
function fold76(b64) {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A faithful HTML shape of a helper's plain-text deliverable. Rules are deliberately few:
 *   - "- ", "• ", "* " lines become list items (consecutive ones share a list);
 *   - a short line (≤ 80 chars, no terminal period) immediately followed by bullets is a
 *     heading; a line that stands alone between blank lines is a heading too when it is
 *     short and ends without punctuation;
 *   - everything else is a paragraph; blank lines separate blocks.
 * Text is escaped; nothing in the body is interpreted as markup.
 */
export function textToHtml(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let list = null;
  const bullet = (l) => /^\s*(?:[-•*]|\d+[.)])\s+/.test(l);
  const strip = (l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "");
  const closeList = () => { if (list) { out.push(`<ul style="margin:4px 0 12px 20px;padding:0">${list.join("")}</ul>`); list = null; } };
  const looksLikeHeading = (l, i) => {
    const t = l.trim();
    if (!t || t.length > 80 || /[.,;!?]$/.test(t)) return false;
    if (t.endsWith(":")) return true;
    const next = lines.slice(i + 1).find((x) => x.trim() !== "");
    if (next !== undefined && bullet(next)) return true;
    // A short, unpunctuated line that opens a block ("What I did", "Friday, September 18")
    // is a heading; a sentence-length one is prose.
    const opensBlock = i === 0 || lines[i - 1].trim() === "";
    return opensBlock && t.length <= 60;
  };
  lines.forEach((l, i) => {
    if (l.trim() === "") { closeList(); return; }
    if (bullet(l)) { (list ??= []).push(`<li style="margin:2px 0">${escapeHtml(strip(l))}</li>`); return; }
    closeList();
    if (looksLikeHeading(l, i)) out.push(`<h3 style="font-size:15px;margin:16px 0 4px">${escapeHtml(l.trim().replace(/:$/, ""))}</h3>`);
    else out.push(`<p style="margin:0 0 10px">${escapeHtml(l.trim())}</p>`);
  });
  closeList();
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1f1f1f;max-width:640px;margin:0;padding:16px">${out.join("\n")}</body></html>`;
}

/**
 * Build the RFC 5322 message Gmail's `messages.send` wants, as base64url. Always
 * multipart/alternative (text + HTML) with base64 bodies and encoded-word headers, so any
 * subject and any body — accents, dashes, emoji — arrive as written.
 */
export function buildRawEmail({ to, from, subject, text, html, replyTo }) {
  const boundary = `familios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const plain = String(text ?? "");
  const rich = html ?? textToHtml(plain);
  const headers = [
    `To: ${encodeHeaderValue(to)}`,
    from ? `From: ${encodeHeaderValue(from)}` : null,
    replyTo ? `Reply-To: ${encodeHeaderValue(replyTo)}` : null,
    `Subject: ${encodeHeaderValue(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=utf-8`,
    "Content-Transfer-Encoding: base64",
    "",
    fold76(Buffer.from(body, "utf8").toString("base64")),
  ].join("\r\n");
  const message = [headers.join("\r\n"), "", part("text/plain", plain), part("text/html", rich), `--${boundary}--`, ""].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
