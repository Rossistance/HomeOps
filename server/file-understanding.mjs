// What's actually IN the file.
//
// Recorded verbatim, the assistant answering its own bug in the 2026-07-25 attachment video:
//
//   "I can help describe the photo, but I don't have access to view the attached image in the
//    context I received."
//   "Attachments are generally meant for any file, document, or photo the chat UI passes
//    through to me. In this conversation, though, I'm NOT RECEIVING READABLE ATTACHMENT
//    CONTENTS, so I can't inspect the specific image you sent here."
//
// It was right. The upload worked, the chip appeared, `attachedFileId` rode along in the
// request context — and the server never opened the file. The model was handed a filename and
// asked to describe a photo. Everything after that was the assistant being honest about an
// emptiness it had no way to fill.
//
// This module is the missing half. It turns a stored blob into text a model can reason over:
// text-ish formats are decoded, images go to the household's own vision model, and anything we
// genuinely cannot read says so plainly rather than returning a confident blank.
import { getFileRec, readFileBlob, getSettings } from "./store.mjs";
import { providerChat } from "./ai.mjs";

/** Roughly a page of dense text; enough to answer questions, small enough to sit in a turn. */
const MAX_TEXT_CHARS = 24_000;
/** Vision APIs reject very large payloads and bill by pixels — this is a sane per-image cap. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const isTextual = (mime, name) =>
  /^text\//i.test(mime) ||
  /^application\/(json|xml|x-ndjson|csv|javascript|typescript)/i.test(mime) ||
  /\.(txt|md|markdown|csv|tsv|json|xml|log|ya?ml|ics|vcf|html?|rtf)$/i.test(name ?? "");

const isImage = (mime, name) =>
  /^image\//i.test(mime) || /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(name ?? "");

const isPdf = (mime, name) => /pdf/i.test(mime) || /\.pdf$/i.test(name ?? "");

/**
 * Best-effort text out of a PDF, with no dependency.
 *
 * A real PDF parser is a large piece of software and this is not one. It pulls text from
 * uncompressed content streams, which covers PDFs produced by "export/print to PDF" — a school
 * form, a receipt, a letter — and misses compressed or scanned ones entirely. When it misses,
 * it returns null and the caller says so out loud. That honesty is the point: a scanned
 * document silently yielding "" would make the assistant confidently discuss a blank page.
 */
function pdfText(buf) {
  const raw = buf.toString("latin1");
  const out = [];
  // Text-showing operators inside BT/ET blocks: (literal) Tj  and  [(a) -2 (b)] TJ
  for (const m of raw.matchAll(/BT([\s\S]{0,20000}?)ET/g)) {
    for (const t of m[1].matchAll(/\(((?:\\.|[^\\()])*)\)\s*(?:Tj|TJ|'|")/g)) {
      out.push(t[1].replace(/\\([nrt])/g, (_, c) => ({ n: "\n", r: "\n", t: "\t" }[c])).replace(/\\(.)/g, "$1"));
    }
  }
  const text = out.join(" ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  // A handful of stray glyphs is not a document; treat it as a miss rather than as content.
  return text.length >= 40 ? text : null;
}

/** The blob for a file record's first page. */
function firstPage(rec) {
  const ids = Array.isArray(rec.pageBlobIds) && rec.pageBlobIds.length ? rec.pageBlobIds : [rec.id];
  return readFileBlob(ids[0]);
}

const VISION_SYS = `You are reading a photo or scan a family uploaded to their household assistant.
Describe what it actually shows, then transcribe every piece of text you can read — names, dates, times, addresses, amounts, phone numbers, item lists.
Preserve structure: if it is a schedule, a form, a receipt or a list, lay it out line by line in the same order it appears.
Do not speculate about anything not visible. If part is illegible, say which part.`;

/**
 * Describe an image using the household's own AI provider.
 *
 * Deliberately uses the household's configured provider rather than a special vision key: a
 * family that connected Claude gets Claude reading their photo, which is the arrangement they
 * already consented to and are already paying for.
 */
async function describeImage({ householdId, mime, base64, prompt }) {
  const providerId = getSettings(householdId).aiActiveProvider;
  if (!providerId) {
    return { ok: false, error: "no_provider", message: "No AI provider is connected, so I can't look at images yet. Add one in Settings → AI Providers." };
  }
  const out = await providerChat(providerId, {
    messages: [
      { role: "system", content: VISION_SYS },
      { role: "user", content: { text: prompt || "What does this show? Transcribe all of its text.", images: [{ mime, base64 }] } },
    ],
  }).catch((e) => ({ ok: false, error: "provider_error", message: String(e?.message ?? e) }));
  if (!out.ok) {
    // A model without vision fails here in a provider-specific way. Say what it means rather
    // than forwarding a raw API error to a family.
    return { ok: false, error: out.error ?? "vision_failed", message: out.message ?? "That model couldn't read the image. A vision-capable model (GPT-5, Claude, Gemini) can." };
  }
  return { ok: true, text: String(out.text ?? "").trim(), model: out.model };
}

/**
 * Read a household file and return something a model can reason over.
 *
 * Returns `{ ok, kind, text, truncated, note }`, or `{ ok:false, error, message }`. `text` is
 * always plain prose or transcription — never base64, never a blob.
 */
export async function understandFile(fileId, { householdId, prompt } = {}) {
  const rec = getFileRec(fileId);
  if (!rec) return { ok: false, error: "not_found", message: "That file isn't in the household library." };
  if (householdId && rec.householdId !== householdId) {
    return { ok: false, error: "not_found", message: "That file isn't in the household library." };
  }
  let buf;
  try { buf = firstPage(rec); } catch { buf = null; }
  if (!buf || buf.length === 0) return { ok: false, error: "empty", message: `"${rec.name}" has no readable content stored.` };

  const mime = rec.mime ?? "application/octet-stream";
  const name = rec.name ?? "";

  if (isTextual(mime, name)) {
    const text = buf.toString("utf8");
    const truncated = text.length > MAX_TEXT_CHARS;
    return { ok: true, kind: "text", name, text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated };
  }

  if (isImage(mime, name)) {
    if (buf.length > MAX_IMAGE_BYTES) {
      return { ok: false, error: "image_too_large", message: `"${name}" is ${(buf.length / 1048576).toFixed(1)} MB — too large to read in one go. A smaller copy or a screenshot works.` };
    }
    const d = await describeImage({ householdId: rec.householdId, mime, base64: buf.toString("base64"), prompt });
    if (!d.ok) return d;
    return { ok: true, kind: "image", name, text: d.text, model: d.model };
  }

  if (isPdf(mime, name)) {
    const text = pdfText(buf);
    if (text) {
      const truncated = text.length > MAX_TEXT_CHARS;
      return { ok: true, kind: "pdf", name, text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated };
    }
    // Scanned or compressed. Saying so beats returning "" and letting the model invent a page.
    return {
      ok: false, error: "pdf_unreadable",
      message: `"${name}" is a PDF I can't pull text out of — it's most likely scanned images rather than text. A photo or screenshot of the page works, and I can read that.`,
    };
  }

  return {
    ok: false, error: "unsupported_type",
    message: `I can't read inside "${name}" (${mime}). Text, CSV, JSON, PDFs with real text, and photos all work.`,
  };
}

/** A short label for the kind of thing this is, for a card or a chip. */
export function fileKindLabel(mime = "", name = "") {
  if (isImage(mime, name)) return "photo";
  if (isPdf(mime, name)) return "PDF";
  if (isTextual(mime, name)) return "document";
  return "file";
}

export { isImage, isTextual, isPdf };
