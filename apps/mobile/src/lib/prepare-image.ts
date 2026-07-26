// Get a photo ready to be looked at.
//
// Reported together, and they turned out to be one problem: "images take forever to upload even
// small images" and "it is still not processing images properly. I would like it to be able to
// have the ability to do that. Text and context from computer vision."
//
// THE PAYLOAD. A photo straight off an iPhone is ~12 megapixels. At quality 0.8 that's several
// megabytes, and base64 adds a third on top, so the app was asking the phone to build a ~5MB
// JSON string, push it over a home connection, and the server to decode it again — for an image
// a vision model is going to read at about 1500px anyway. Everything above that resolution is
// upload time and API cost spent on detail nothing consumes.
//
// THE FORMAT, which is the part that made vision fail rather than merely slow. iPhones shoot
// HEIC. The picker will hand you a HEIC mime type, and every vision API worth calling rejects
// HEIC outright — so the pipeline was working exactly as built, right up to a provider refusing
// the format, and the honest error it produced ("that model couldn't read the image") pointed at
// the model instead of at us.
//
// So: resize, and re-encode as JPEG, always. Not conditionally on the mime type we were handed —
// HEIC arrives labelled several different ways depending on iOS version and picker path, and a
// format allowlist is a thing that goes stale. Re-encoding unconditionally costs one fast native
// operation and removes the entire class of problem.
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** Long edge, in pixels. Well above what a vision model resolves; well below a phone camera. */
const MAX_EDGE = 1600;
const QUALITY = 0.72;

export interface PreparedImage {
  base64: string;
  mime: string;
  name: string;
  /** Bytes of the decoded image, for the size cap and for honest error messages. */
  bytes: number;
}

/**
 * Resize + re-encode a picked image. Returns null if it can't be read at all.
 *
 * `width`/`height` are the picker's, when it knows them: resizing needs one dimension and
 * scaling the long edge keeps the aspect ratio without having to compute the other. When the
 * picker doesn't report a size we cap the width, which is the safe direction — a portrait photo
 * ends up slightly smaller than necessary rather than slightly too big.
 */
export async function prepareImage(
  uri: string,
  { name, width, height }: { name?: string | null; width?: number | null; height?: number | null } = {},
): Promise<PreparedImage | null> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    const longEdge = Math.max(width ?? 0, height ?? 0);
    if (longEdge > MAX_EDGE) {
      // Scale by whichever edge is longer, so the result fits inside MAX_EDGE either way.
      ctx.resize((width ?? 0) >= (height ?? 0) ? { width: MAX_EDGE } : { height: MAX_EDGE });
    } else if (!longEdge) {
      ctx.resize({ width: MAX_EDGE });
    }
    const image = await ctx.renderAsync();
    const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
    if (!out.base64) return null;
    return {
      base64: out.base64,
      mime: "image/jpeg",
      // Keep the original name for the bubble and the library, but tell the truth about the
      // format, since that's what's actually stored now.
      name: withJpegExtension(name ?? `photo-${Date.now()}`),
      bytes: Math.round(out.base64.length * 0.75),
    };
  } catch {
    return null;
  }
}

function withJpegExtension(name: string): string {
  return /\.jpe?g$/i.test(name) ? name : `${name.replace(/\.[^.]+$/, "")}.jpg`;
}
