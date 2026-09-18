// Picking and uploading things to attach to a family message: photos (library or camera),
// documents, and a recorded voice note. Each returns a ready MessageAttachment or null when
// the person cancelled; a failure throws with a sentence for a person.
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import { prepareImage } from "@/lib/prepare-image";
import { rememberFile } from "@/lib/file-data";
import { api, type MessageAttachment } from "@/lib/api";

/** Server cap (server/index.mjs MAX_FILE_BYTES). The upload sheet used to say 5 MB here. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type FileAttachment = Extract<MessageAttachment, { kind: "file" }>;

async function upload({ name, base64, mime, participantIds }: { name: string; base64: string; mime: string; participantIds: string[] }): Promise<FileAttachment> {
  const r = await api.uploadFile({ name, contentBase64: base64, mime, kind: "message", visibility: "private", participantIds, tags: ["message"] });
  if (!r.file) throw new Error(r.message ?? (r.error === "too_large" ? "That file is over the 25 MB cap." : r.error === "insufficient_role" ? "Your role can't upload files." : "Upload failed."));
  rememberFile(r.file.id, mime, base64);
  return { kind: "file", fileId: r.file.id, name: r.file.name ?? name, mime };
}

export async function pickPhotos(camera: boolean, participantIds: string[]): Promise<FileAttachment[] | null> {
  const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(camera ? "Camera access was denied." : "Photo library access was denied.");
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, allowsMultipleSelection: !camera, selectionLimit: 6 };
  const res = camera
    ? await ImagePicker.launchCameraAsync(opts).catch(() => ImagePicker.launchImageLibraryAsync(opts))
    : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.length) return null;
  const out: FileAttachment[] = [];
  for (const a of res.assets) {
    const prepped = await prepareImage(a.uri, { name: a.fileName ?? `photo-${Date.now()}.jpg`, width: a.width, height: a.height });
    if (!prepped) throw new Error("Couldn't read that photo.");
    if (prepped.bytes > MAX_ATTACHMENT_BYTES) throw new Error("That photo is over the 25 MB cap.");
    out.push(await upload({ name: prepped.name, base64: prepped.base64, mime: prepped.mime, participantIds }));
  }
  return out;
}

export async function pickDocument(participantIds: string[]): Promise<FileAttachment | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  if ((a.size ?? 0) > MAX_ATTACHMENT_BYTES) throw new Error("That file is over the 25 MB cap.");
  const base64 = await readAsStringAsync(a.uri, { encoding: "base64" });
  return upload({ name: a.name ?? "document", base64, mime: a.mimeType ?? "application/octet-stream", participantIds });
}

export async function uploadVoiceNote(uri: string, durationMs: number, participantIds: string[]): Promise<FileAttachment> {
  const base64 = await readAsStringAsync(uri, { encoding: "base64" });
  const att = await upload({ name: `Voice note ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.m4a`, base64, mime: "audio/mp4", participantIds });
  return { ...att, audio: { durationMs } };
}
