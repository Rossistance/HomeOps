// What an attachment looks like before and after you send it.
//
// "The way that it was attached and previewed to me was just as text. It needs to be a live
//  preview in the chat, just like any other chat interface would have… If I'm uploading an
//  image at the bottom, I need to see a very small box that depicts it — whether it's an image,
//  a document, or any sort of file. I need to be able to preview it, if possible… These are
//  document examples that have been attached. I just see their name. I don't see their visual
//  representation, a miniature thumbnail of them, the actual documents, just like you would see
//  in ChatGPT."
//
// It was a pill with a filename in it, which is the least a chat can do with a photo you just
// took. A thumbnail answers "did the right one attach" without opening anything, and that's the
// question you actually have in the half-second after picking.
//
// AN IMAGE SHOWS ITSELF; A DOCUMENT SHOWS WHAT IT IS. We can't rasterise a PDF's first page on
// device without shipping a renderer, so rather than fake a page preview a document gets a
// tile in its own type's colour with its extension on it — legible at 44pt, honest about being
// a stand-in, and still tells two attachments apart at a glance, which the filename pill
// didn't when both were called IMG_2975.
import { View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "@/theme";
import { depth, rimColor } from "@/theme/neumorph";
import { categoryLook } from "@/theme/categories";
import { T } from "./ui/text";
import { Sym } from "./ui/symbol";

const isImage = (mime?: string, name?: string) =>
  /^image\//i.test(mime ?? "") || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(name ?? "");

/** The file's own extension, for the document tile. */
function extOf(name?: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name ?? "");
  return (m?.[1] ?? "file").toUpperCase();
}

/** Icon and tone by document type, so a PDF and a spreadsheet aren't the same grey square. */
function docLook(name?: string, mime?: string) {
  const hay = `${name ?? ""} ${mime ?? ""}`.toLowerCase();
  if (/pdf/.test(hay)) return { icon: "doc", tone: "rose" as const };
  if (/sheet|csv|xls|numbers/.test(hay)) return { icon: "chart", tone: "moss" as const };
  if (/doc|word|pages|txt|rtf|md/.test(hay)) return { icon: "doc", tone: "indigo" as const };
  if (/zip|tar|gz/.test(hay)) return { icon: "folder", tone: "clay" as const };
  return { icon: "paperclip", tone: "sky" as const };
}

export function AttachmentTile({
  name, uri, mime, size = 44, remoteUrl,
}: {
  name?: string;
  /** Local file uri — available the instant a photo is picked. */
  uri?: string;
  mime?: string;
  size?: number;
  /** Server-side preview, once it exists. Falls back to `uri`. */
  remoteUrl?: string;
}) {
  const { colors, dark } = useTheme();
  const src = remoteUrl ?? uri;

  if (isImage(mime, name) && src) {
    return (
      <Image
        source={{ uri: src }}
        contentFit="cover"
        accessibilityLabel={name ? `Attached image: ${name}` : "Attached image"}
        style={{
          width: size, height: size,
          borderRadius: Math.round(size * 0.22),
          borderWidth: 1, borderColor: rimColor(colors, dark),
        }}
      />
    );
  }

  const look = docLook(name, mime);
  const tone = colors[look.tone] as string;
  return (
    <View
      accessibilityLabel={name ? `Attached file: ${name}` : "Attached file"}
      style={{
        width: size, height: size,
        borderRadius: Math.round(size * 0.22), borderCurve: "continuous",
        backgroundColor: colors[`${look.tone}Bg` as keyof typeof colors] as string,
        borderWidth: 1, borderColor: rimColor(colors, dark),
        boxShadow: depth("raisedSm", colors, dark),
        alignItems: "center", justifyContent: "center", gap: 1,
      }}
    >
      <Sym name={look.icon} size={Math.round(size * 0.36)} color={tone} />
      <T kind="caption" color={tone} style={{ fontSize: Math.max(7, Math.round(size * 0.16)), fontWeight: "700" }}>
        {extOf(name)}
      </T>
    </View>
  );
}

/** Kept for callers that want the category tone of an arbitrary label. */
export { categoryLook };
